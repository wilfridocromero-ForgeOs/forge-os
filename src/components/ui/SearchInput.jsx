import { Search } from "lucide-react";
import Input from "./Input";

export default function SearchInput(props) {
  return (
    <Input
      leftIcon={Search}
      placeholder="Buscar..."
      {...props}
    />
  );
}