update public.knowledge_folders
set name = 'Fundaci' || chr(243) || 'n ORVESEN'
where parent_id is null
  and name in (
    'Fundaci' || chr(195) || chr(179) || 'n ORVESEN',
    'Fundaci' || chr(243) || 'n ORVESEN'
  );
