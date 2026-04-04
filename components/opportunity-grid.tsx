import type { OpportunityCard } from "@/types/domain";

interface OpportunityGridProps {
  cards: OpportunityCard[];
}

export function OpportunityGrid({ cards }: OpportunityGridProps) {
  return (
    <section className="card-grid">
      {cards.map((card) => (
        <article key={card.title} className={`panel insight-card insight-${card.tone}`}>
          <p className="eyebrow">{card.sourceLabel}</p>
          <h3>{card.title}</h3>
          <p className="muted">{card.summary}</p>
        </article>
      ))}
    </section>
  );
}
