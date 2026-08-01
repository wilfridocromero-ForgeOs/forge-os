import { useOrganization } from "./OrganizationContext";

export default function useNavigation() {
  const { navigation } = useOrganization();

  function getRoute(title) {
    return navigation.find(
      (item) => item.title === title
    );
  }

  return {
    navigation,
    getRoute,
  };
}