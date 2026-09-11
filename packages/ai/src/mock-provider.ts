import type { ConversationContext } from "@homeair/conversation";
import type { AnalyseOutput, Answer, ConversationAnalysis, Suggestion } from "@homeair/shared";
import type { AIProvider, QuestionRequest, ResponseRequest } from "./provider";

/**
 * Canned provider so the whole app runs end to end with no API key. It does
 * not look at the transcript beyond the other person's name; its job is to
 * exercise the UI and the plumbing, not to be clever.
 */
export class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly model = "mock";
  constructor(private readonly delayMs = 400) {}

  async analyseConversation(ctx: ConversationContext): Promise<AnalyseOutput> {
    await sleep(this.delayMs);
    const other = ctx.otherName;
    const analysis: ConversationAnalysis = {
      escalation_level: "high_conflict",
      surface_topic: "Whether the user did the thing that was asked",
      underlying_issue: `${other} appears to be saying the task itself is no longer the issue; how the user responded afterwards felt dismissive.`,
      user_position: "The factual accusation is unfair; the task was done.",
      other_position: `${other} feels unheard when raising something that bothers her, and the user's replies have focused on facts rather than that.`,
      misalignment: `The user is defending task completion; ${other} is talking about the interpersonal response.`,
      repeated_patterns: ["User restates that the task was done (twice)"],
      recommended_action: "acknowledge",
      reply_now: true,
      warning: {
        kind: "wrong_battle",
        headline: "WRONG BATTLE",
        detail: `${poss(other)} latest message is primarily about feeling dismissed. A factual rebuttal right now is likely to sound like further dismissal. Acknowledge the emotional point first.`,
      },
      confidence: 0.82,
    };
    const suggestion: Suggestion = {
      text: "Right, I understand the distinction now. I've been defending whether I did the thing, and you're talking about how I responded afterwards. Tell me what I said or did that felt dismissive because that's the bit I should actually be answering.",
      reasoning: "Acknowledges the clarified issue without conceding the factual point, and asks a specific question instead of defending.",
    };
    return { analysis, suggestion };
  }

  async generateResponse(req: ResponseRequest): Promise<Suggestion> {
    await sleep(this.delayMs);
    const base = req.previousSuggestion ?? "I get what you're saying now. Tell me what felt dismissive.";
    const variants: Record<typeof req.mode, string> = {
      default: base,
      shorter: "Fair enough, I've been answering the wrong question. What did I say that felt dismissive?",
      warmer:
        "I don't want you feeling like I brush you off. I got stuck defending what happened instead of hearing why it bothered you. Tell me what felt dismissive and I'll actually listen this time.",
      more_direct: "You're right that I answered the wrong thing. What specifically felt dismissive?",
      more_like_me:
        "OK yeah, I went full lawyer on the wrong point there. Forget whether I did the thing — what did I say after that made you feel fobbed off?",
      de_escalate:
        "I don't want this turning into a bigger row. I've been arguing the wrong point. Can you tell me what felt dismissive so I can actually answer that?",
      clarify: "When you say the way I spoke to you afterwards — was it what I said, or how I said it?",
    };
    return { text: variants[req.mode], reasoning: `Mock variant for mode "${req.mode}".` };
  }

  async answerQuestion(req: QuestionRequest): Promise<Answer> {
    await sleep(this.delayMs);
    const other = req.ctx.otherName;
    const answers: Record<typeof req.question, string> = {
      explain_their_view: `${other} appears to be saying that the task isn't the point — the way you responded afterwards is.\n\n- What seems to matter: being heard when she raises something.\n- What she may want acknowledged: that your reply felt like being argued with rather than listened to.\n- Uncertain: whether "the way you spoke" means tone, wording, or timing. Worth asking.`,
      explain_my_view: "You did what was asked, and being told you never listen felt unfair given that. You've been trying to establish the facts because the accusation reads as untrue to you. That is a reasonable position on the facts.",
      what_are_we_arguing_about:
        "Triggering event: a request you completed yesterday.\n\nFactual disagreement: initially whether you did it — now explicitly withdrawn by her.\n\nEmotional disagreement: whether your response afterwards was dismissive.\n\nHistorical baggage: \"you never listen\" — a pattern claim, not about yesterday.\n\nResolution each wants: you want the unfair accusation dropped; she appears to want acknowledgement of how the response landed.",
      am_i_being_unreasonable:
        "You're reasonable on the factual point — you did the thing. But your last two messages are answering a question she has now said she isn't asking, so from her side it reads as not listening, which is the original complaint. Her opening line is a sweeping claim and it's fair to feel stung by it.",
      what_to_avoid:
        "- Another \"but I did it\" — she has said twice that isn't the point; it will land as proof of the complaint.\n- \"I'm just saying what happened\" — reads as dismissing the emotional point again.\n- Relitigating \"you never listen\" as a factual claim right now.\n\nInstead: acknowledge the clarified issue and ask what specifically felt dismissive.",
    };
    return { answer: answers[req.question] };
  }
}

function poss(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "her" || lower === "them") return name;
  if (lower === "him") return "His";
  return `${name}'s`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
