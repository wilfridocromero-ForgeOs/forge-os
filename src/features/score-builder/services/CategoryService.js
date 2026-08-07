import { supabase } from "../../../lib/supabase";

/*
|--------------------------------------------------------------------------
| Obtener categorías
|--------------------------------------------------------------------------
*/

export async function loadCategories() {

    return await supabase

        .from("score_library_categories")

        .select(`
            *,
            divisions(
                id,
                name
            )
        `)

        .order("position");

}

/*
|--------------------------------------------------------------------------
| Obtener una categoría
|--------------------------------------------------------------------------
*/

export async function getCategory(id){

    return await supabase

        .from("score_library_categories")

        .select(`
            *,
            divisions(
                id,
                name
            )
        `)

        .eq("id",id)

        .maybeSingle();

}

/*
|--------------------------------------------------------------------------
| Crear categoría
|--------------------------------------------------------------------------
*/

export async function createCategory(category){

    return await supabase

        .from("score_library_categories")

        .insert({

            name:category.name,

            description:category.description,

            division_id:category.division_id,

            color:category.color,

            icon:category.icon,

            position:category.position ?? 0,

            active:true,

        })

        .select()

        .single();

}

/*
|--------------------------------------------------------------------------
| Actualizar categoría
|--------------------------------------------------------------------------
*/

export async function updateCategory(id,data){

    return await supabase

        .from("score_library_categories")

        .update({

            ...data,

            updated_at:new Date().toISOString(),

        })

        .eq("id",id)

        .select()

        .single();

}

/*
|--------------------------------------------------------------------------
| Eliminar categoría
|--------------------------------------------------------------------------
*/

export async function deleteCategory(id){

    return await supabase

        .from("score_library_categories")

        .delete()

        .eq("id",id);

}

/*
|--------------------------------------------------------------------------
| Archivar categoría
|--------------------------------------------------------------------------
*/

export async function archiveCategory(id){

    return await supabase

        .from("score_library_categories")

        .update({

            active:false,

            updated_at:new Date().toISOString(),

        })

        .eq("id",id);

}

/*
|--------------------------------------------------------------------------
| Restaurar categoría
|--------------------------------------------------------------------------
*/

export async function restoreCategory(id){

    return await supabase

        .from("score_library_categories")

        .update({

            active:true,

            updated_at:new Date().toISOString(),

        })

        .eq("id",id);

}