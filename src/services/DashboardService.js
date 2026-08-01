import OrganizationService from "./OrganizationService";
import AIService from "./AIService";

class DashboardService {
  getDashboard() {
    const organization =
      OrganizationService.getOrganization();

    return {
      greeting: {
        eyebrow: "ORVESEN PLATFORM",

        title: `Buenos días, ${organization.owner.firstName}.`,

        description:
          AIService.getGreeting(),
      },

      score:
        OrganizationService.getScore(),

      projects:
        OrganizationService.getProjects(),

      playbooks:
        OrganizationService.getPlaybooks(),

      discovery:
        OrganizationService.getDiscovery(),

      nextAction:
        AIService.getNextAction(),

      recommendations:
        AIService.getRecommendations(),
    };
  }
}

export default new DashboardService();