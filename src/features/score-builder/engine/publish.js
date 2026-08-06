import validate from "./validate";
import save from "./save";

import { supabase } from "../../../lib/supabase";

export default async function publish(form, profile, user) {

    // Validar antes de publicar
    const validation = validate(form);

    if (!validation.valid) {

        return {

            success: false,

            errors: validation.errors,

        };

    }

    // Guardar si todavía no existe
    const result = await save(form, profile, user);

    if (!result.success) {

        return result;

    }

    // Cambiar estado
    const update = await supabase

        .from("score_templates")

        .update({

            status: "published",

            published_at: new Date().toISOString(),

        })

        .eq("id", result.template.id)

        .select()

        .single();

    if (update.error) {

        throw update.error;

    }

    return {

        success: true,

        template: update.data,

    };

}