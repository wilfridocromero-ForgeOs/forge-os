import { organization } from "../data/organization";

class OrganizationService {
  getOrganization() {
    return organization;
  }

  getOwner() {
    return organization.owner;
  }

  getCompany() {
    return {
      id: organization.id,
      name: organization.name,
      legalName: organization.legalName,
      industry: organization.industry,
    };
  }

  getScore() {
    return organization.score;
  }

  getProjects() {
    return organization.projects;
  }

  getPlaybooks() {
    return organization.playbooks;
  }

  getDiscovery() {
    return organization.discovery;
  }

  getSubscription() {
    return organization.subscription;
  }

  updateOrganization(data) {
    Object.assign(organization, data);

    return organization;
  }

  updateScore(score) {
    organization.score = {
      ...organization.score,
      ...score,
    };

    return organization.score;
  }
}

export default new OrganizationService();