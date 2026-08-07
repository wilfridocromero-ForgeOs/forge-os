import { useEffect, useState } from "react";

import {

    loadCategories,

    createCategory,

    updateCategory,

    deleteCategory,

} from "../services/CategoryService";

export default function useCategories(){

    const [loading,setLoading]=useState(true);

    const [categories,setCategories]=useState([]);

    async function reload(){

        setLoading(true);

        const {data,error}=await loadCategories();

        if(!error){

            setCategories(data||[]);

        }

        setLoading(false);

    }

    async function addCategory(category){

        const result=await createCategory(category);

        if(!result.error){

            await reload();

        }

        return result;

    }

    async function editCategory(id,data){

        const result=await updateCategory(id,data);

        if(!result.error){

            await reload();

        }

        return result;

    }

    async function removeCategory(id){

        const result=await deleteCategory(id);

        if(!result.error){

            await reload();

        }

        return result;

    }

    useEffect(()=>{

        reload();

    },[]);

    return{

        loading,

        categories,

        reload,

        addCategory,

        editCategory,

        removeCategory,

    };

}