import {
  Mail,
  Phone,
  MoreHorizontal,
} from "lucide-react";

import Avatar from "../../../components/ui/Avatar";

export default function ClientHeader({
  name,
  company,
  email,
  phone,
}) {
  return (
    <div className="flex items-start justify-between">

      <div className="flex gap-5">

        <Avatar
          name={name}
          size="lg"
        />

        <div>

          <h2 className="text-2xl font-semibold text-white">
            {name}
          </h2>

          <p className="mt-1 text-zinc-500">
            {company}
          </p>

          <div className="mt-6 flex flex-wrap gap-6">

            <div className="flex items-center gap-2 text-zinc-400">

              <Mail size={16} />

              <span className="text-sm">
                {email}
              </span>

            </div>

            <div className="flex items-center gap-2 text-zinc-400">

              <Phone size={16} />

              <span className="text-sm">
                {phone}
              </span>

            </div>

          </div>

        </div>

      </div>

      <button
        className="
          flex
          h-12
          w-12
          items-center
          justify-center

          rounded-2xl

          border
          border-zinc-800

          bg-[#17171A]

          transition-all
          duration-300

          hover:border-zinc-600
          hover:bg-[#1D1D21]
        "
      >
        <MoreHorizontal
          size={18}
          className="text-zinc-300"
        />
      </button>

    </div>
  );
}