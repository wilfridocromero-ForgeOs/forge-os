import CategoryCard from "./CategoryCard";

export default function CategoryGrid({ categories = [] }) {
  return (
    <section
      className="
        grid
        gap-6

        md:grid-cols-2

        xl:grid-cols-3
      "
    >
      {categories.map((category) => (
        <CategoryCard
          key={category.title}
          title={category.title}
          score={category.score}
          description={category.description}
        />
      ))}
    </section>
  );
}