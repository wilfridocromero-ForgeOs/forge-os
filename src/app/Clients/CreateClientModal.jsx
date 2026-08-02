import { useState } from "react";

import { createClient } from "../../services/ClientService";


export default function CreateClientModal({
  organizationId,
  onCreated,
  onClose,
}) {


  const [form, setForm] = useState({

    company_name: "",

    contact_name: "",

    email: "",

    phone: "",

    website: "",

    industry: "",

    status: "lead",

    score: 0,

    organization_id: organizationId,

  });



  const [loading, setLoading] = useState(false);



  function handleChange(e){

    setForm({

      ...form,

      [e.target.name]: e.target.value,

    });

  }




  async function handleSubmit(e){

    e.preventDefault();


    try {

      setLoading(true);


      const client =
        await createClient(form);


      onCreated(client);


      onClose();


    } catch(error){

      console.error(error);

      alert(
        "Error creando cliente"
      );

    } finally {

      setLoading(false);

    }

  }



  return (

    <div
      className="
      fixed
      inset-0
      z-50
      flex
      items-center
      justify-center
      bg-black/70
      "
    >


      <div
        className="
        w-full
        max-w-xl
        rounded-3xl
        border
        border-zinc-800
        bg-[#111113]
        p-8
        "
      >


        <h2
          className="
          text-2xl
          font-semibold
          text-white
          "
        >
          Nuevo Cliente
        </h2>


        <p
          className="
          mt-2
          text-zinc-500
          "
        >
          Agrega una nueva organización a ORVESEN.
        </p>



        <form
          onSubmit={handleSubmit}
          className="
          mt-8
          space-y-5
          "
        >



          <input
            name="company_name"
            placeholder="Nombre de empresa"
            value={form.company_name}
            onChange={handleChange}
            className="input"
            required
          />



          <input
            name="contact_name"
            placeholder="Persona contacto"
            value={form.contact_name}
            onChange={handleChange}
            className="input"
          />



          <input
            name="email"
            placeholder="Email"
            value={form.email}
            onChange={handleChange}
            className="input"
          />



          <input
            name="phone"
            placeholder="Teléfono"
            value={form.phone}
            onChange={handleChange}
            className="input"
          />



          <input
            name="industry"
            placeholder="Industria"
            value={form.industry}
            onChange={handleChange}
            className="input"
          />



          <div
            className="
            flex
            justify-end
            gap-4
            pt-5
            "
          >

            <button
              type="button"
              onClick={onClose}
              className="
              rounded-xl
              px-5
              py-3
              text-zinc-400
              hover:text-white
              "
            >
              Cancelar
            </button>


            <button
              disabled={loading}
              className="
              rounded-xl
              bg-white
              px-6
              py-3
              font-medium
              text-black
              "
            >

              {
                loading
                ? "Guardando..."
                : "Crear Cliente"
              }

            </button>


          </div>


        </form>


      </div>


    </div>

  );

}