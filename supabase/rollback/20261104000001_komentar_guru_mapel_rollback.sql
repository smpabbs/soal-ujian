-- Rollback: guru pengampu mapel boleh masuk dan mengomentari soal
-- Pasangan: supabase/migrations/20261104000001_komentar_guru_mapel.sql
--
-- ⚠️ Menghapus tabel berarti menghapus SELURUH komentar yang sudah ditulis.
--    Jalankan hanya bila fitur ini memang dibatalkan, bukan untuk mengulang
--    migrasi. Untuk mengulang, cukup jalankan migrasi aslinya lagi — seluruh
--    DDL-nya idempoten kecuali CREATE POLICY (sudah didahului DROP).

BEGIN;

DROP FUNCTION IF EXISTS psat.get_jumlah_komentar(uuid[]);
DROP FUNCTION IF EXISTS psat.hapus_komentar(uuid);
DROP FUNCTION IF EXISTS psat.tambah_komentar(uuid, text, uuid);
DROP FUNCTION IF EXISTS psat.get_komentar_soal(uuid);
DROP FUNCTION IF EXISTS psat.get_soal_komentator(uuid);

DROP TABLE IF EXISTS psat.soal_komentar;

DROP FUNCTION IF EXISTS psat.boleh_komentar_soal(uuid);
DROP FUNCTION IF EXISTS psat.akses_saya();
DROP FUNCTION IF EXISTS psat.saya_admin();
DROP FUNCTION IF EXISTS psat.saya_mengampu_mapel(uuid);
DROP FUNCTION IF EXISTS psat.mapel_komentar_saya();
DROP FUNCTION IF EXISTS psat.boleh_menulis_soal();

COMMIT;

NOTIFY pgrst, 'reload schema';
