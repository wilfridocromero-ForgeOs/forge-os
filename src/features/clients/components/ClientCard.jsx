import Card from "../../../components/ui/Card";

import ClientHeader from "./ClientHeader";
import ClientScoreRing from "./ClientScoreRing";
import ClientMetrics from "./ClientMetrics";
import ClientFooter from "./ClientFooter";

export default function ClientCard({
  client,
}) {
  return (
    <Card
      glow
      className="
        w-full

        transition-all
        duration-500

        hover:-translate-y-1
      "
    >
      {/* HEADER */}

      <ClientHeader
        name={client.name}
        company={client.company}
        email={client.email}
        phone={client.phone}
      />

      {/* Divider */}

      <div className="my-10 h-px bg-zinc-800" />

      {/* Score + Metrics */}

      <div
        className="
          grid

          gap-10

          xl:grid-cols-[220px_1fr]

          items-center
        "
      >
        <div className="flex justify-center">

          <ClientScoreRing
            score={client.score}
          />

        </div>

        <ClientMetrics
          discovery={client.discovery}
          playbooks={client.playbooks}
          projects={client.projects}
          improvement={client.improvement}
        />

      </div>

      {/* Footer */}

      <ClientFooter
        recommendation={client.recommendation}
      />
    </Card>
  );
}