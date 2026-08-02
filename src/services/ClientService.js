import { supabase } from "../lib/supabase";


// Obtener todos los clientes de una organización

export async function getClients(organizationId) {

  const {
    data,
    error
  } = await supabase

    .from("clients")

    .select(`
      id,
      company_name,
      contact_name,
      email,
      phone,
      website,
      industry,
      status,
      score,
      created_at
    `)

    .eq(
      "organization_id",
      organizationId
    )

    .order(
      "created_at",
      {
        ascending: false,
      }
    );


  if (error) {
    throw error;
  }


  return data;

}





// Obtener un cliente específico

export async function getClient(clientId) {

  const {
    data,
    error
  } = await supabase

    .from("clients")

    .select(`
      id,
      company_name,
      contact_name,
      email,
      phone,
      website,
      industry,
      status,
      score,
      created_at
    `)

    .eq(
      "id",
      clientId
    )

    .single();


  if (error) {
    throw error;
  }


  return data;

}





// Crear un nuevo cliente

export async function createClient(clientData) {

  const {
    data,
    error
  } = await supabase

    .from("clients")

    .insert([
      clientData
    ])

    .select()

    .single();


  if (error) {
    throw error;
  }


  return data;

}





// Actualizar cliente

export async function updateClient(
  clientId,
  updates
) {

  const {
    data,
    error
  } = await supabase

    .from("clients")

    .update(updates)

    .eq(
      "id",
      clientId
    )

    .select()

    .single();


  if (error) {
    throw error;
  }


  return data;

}





// Eliminar cliente

export async function deleteClient(clientId) {

  const {
    error
  } = await supabase

    .from("clients")

    .delete()

    .eq(
      "id",
      clientId
    );


  if (error) {
    throw error;
  }


  return true;

}