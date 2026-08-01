import { ai } from "../data/ai";

class AIService {
  getGreeting() {
    return ai.greeting;
  }

  getSummary() {
    return ai.summary;
  }

  getRecommendations() {
    return ai.recommendations;
  }

  getStrengths() {
    return ai.strengths;
  }

  getRisks() {
    return ai.risks;
  }

  getNextAction() {
    return ai.nextAction;
  }
}

export default new AIService();