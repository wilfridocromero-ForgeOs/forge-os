import { useEffect, useState } from "react";

import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";

import Card from "../components/ui/Card";

import Button from "../components/ui/Button";

import CreateClientModal from "./Clients/CreateClientModal";

import {
  getClients
} from "../services/ClientService";

import {
  useOrganization
} from "../Context/OrganizationContext";


export default function Clients() {


  const {
    organization
  } = useOrganization();


  const [
    clients,
    setClients
  ] = useState([]);


  const [
    loading,
    setLoading
  ] = useState(true);


  const [
    openModal,
    setOpenModal
  ] = useState(false);



  async function loadClients(){


    if(!organization?.id){
      setLoading(false);
      return;
    }


    try {


      const data =
        await getClients(
          organization.id
        );


      setClients(data);


    } catch(error){

      console.error(
        error
      );

    } finally {

      setLoading(false);

    }

  }




  useEffect(()=>{

    loadClients();

  },[
    organization
  ]);





  function handleCreated(client){


    setClients(
      previous => [
        client,
        ...previous
      ]
    );


  }





  return (

    <Page>


      <div
        className="
        flex
        items-start
        justify-between
        gap-6
        "
      >


        <PageHeader

          eyebrow="CLIENTES"

          title="Gestión de clientes"

          description="
          Administra las organizaciones que forman parte de ORVESEN.
          "

        />



        <Button
          onClick={() => setOpenModal(true)}
          className="mt-8"
        >

          + Nuevo Cliente

        </Button>


      </div>





      <section
        className="
        mt-10
        "
      >


        {
          loading && (

            <p
              className="
              text-zinc-500
              "
            >
              Cargando clientes...
            </p>

          )
        }




        {
          !loading &&
          clients.length === 0 && (

            <Card>

              <div
                className="
                py-12
                text-center
                "
              >

                <h3
                  className="
                  text-xl
                  text-white
                  font-semibold
                  "
                >
                  No tienes clientes todavía
                </h3>


                <p
                  className="
                  mt-3
                  text-zinc-500
                  "
                >
                  Crea tu primer cliente para comenzar.
                </p>


              </div>

            </Card>

          )
        }





        <div
          className="
          grid
          gap-6
          lg:grid-cols-2
          "
        >


          {
            clients.map(client => (

              <Card
                key={client.id}
              >

                <h2
                  className="
                  text-xl
                  font-semibold
                  text-white
                  "
                >
                  {client.company_name}
                </h2>


                <p
                  className="
                  mt-2
                  text-zinc-400
                  "
                >
                  {client.contact_name}
                </p>


                <p
                  className="
                  mt-4
                  text-sm
                  text-zinc-500
                  "
                >
                  {client.email}
                </p>



                <div
                  className="
                  mt-6
                  flex
                  justify-between
                  "
                >

                  <span
                    className="
                    rounded-full
                    bg-zinc-800
                    px-3
                    py-1
                    text-xs
                    text-zinc-300
                    "
                  >
                    {client.status}
                  </span>


                  <span
                    className="
                    text-zinc-400
                    "
                  >
                    Score: {client.score}
                  </span>


                </div>


              </Card>

            ))
          }


        </div>


      </section>





      {
        openModal && (

          <CreateClientModal

            organizationId={
              organization?.id
            }

            onCreated={
              handleCreated
            }

            onClose={
              () => setOpenModal(false)
            }

          />

        )
      }



    </Page>

  );

}