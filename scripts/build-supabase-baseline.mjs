// Genera supabase/baseline/0001_lalo_baseline.sql concatenando, en orden,
// todas las migraciones de supabase/migrations/. Sirve para montar un proyecto
// Supabase NUEVO con un solo archivo. Uso: node scripts/build-supabase-baseline.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
const files = readdirSync(resolve(root, 'migrations'))
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort(); // 0018_elevenlabs antes que 0018_tournament_intro (alfabético = orden original)

const header = `-- =============================================================================
-- 0001_lalo_baseline.sql  (GENERADO: no editar a mano)
--
-- Une, en orden, las ${files.length} migraciones de supabase/migrations/ (${files[0]} a ${files[files.length - 1]}).
-- Para proyectos Supabase NUEVOS. Regenerar: node scripts/build-supabase-baseline.mjs
-- El historial detallado sigue en supabase/migrations/ (los tests leen esos archivos).
-- =============================================================================
`;

const body = files
  .map((f) => `\n-- >>>>>>>>>> ${f} >>>>>>>>>>\n${readFileSync(resolve(root, 'migrations', f), 'utf8').replace(/\r\n/g, '\n').trimEnd()}\n`)
  .join('');

mkdirSync(resolve(root, 'baseline'), { recursive: true });
writeFileSync(resolve(root, 'baseline', '0001_lalo_baseline.sql'), header + body);
console.log(`Baseline: ${files.length} migraciones -> supabase/baseline/0001_lalo_baseline.sql`);
