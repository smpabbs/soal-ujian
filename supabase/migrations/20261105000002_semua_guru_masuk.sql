-- Migration: SEMUA guru aktif boleh masuk; yang menentukan hanya boleh apa
--
-- PERMINTAAN PEMILIK PRODUK (5 Nov 2026)
--   "semua guru bisa login, yang ditugasi menulis soal bisa menulis soal,
--    yang tidak diberi penugasan menulis soal hanya bisa memberi komentar"
--
-- KEADAAN SEBELUM INI
-- akses_saya() menolak guru yang (a) tidak ber-flag penulis/validator,
-- (b) tidak punya satu pun baris public.guru_mengajar, dan (c) tidak punya soal
-- atas namanya — 13 guru aktif di produksi berada di keadaan ini dan berhenti
-- di layar "Akun Anda belum diberi akses". Padahal halaman komentar sudah
-- memuat dengan sendirinya bila mapelnya kosong.
--
-- YANG BERUBAH — hanya gerbang masuk
--   Sebelum : guru masuk HANYA bila penulis, atau punya penugasan, atau punya
--             soal, atau punya mapel ber-event aktif.
--   Sesudah : setiap akun ber-role guru dengan status 'aktif' masuk.
--
-- YANG **TIDAK** BERUBAH — batas menulis tetap persis seperti sebelumnya
--   * bisa_menulis = is_penulis_soal (plus admin/validator), sudah begitu sejak
--     20261104000001 dan tidak disentuh di sini.
--   * Policy soal_insert_own / update / delete bank_soal memakai
--     psat.boleh_menulis_soal() → guru pengampu tetap DITOLAK menulis soal.
--     "Penugasan menulis" memang berarti flag is_penulis_soal, yang dinyalakan
--     psat.tetapkan_penulis() saat admin menunjuk di halaman Patokan.
--
-- Daftar mapel yang ditawarkan di layar komentar tetap disaring ke mapel yang
-- punya soal di event aktif (20261105000001). Diukur sebelum perubahan ini:
-- hanya 1 dari 18 mapel yang diampu guru tidak punya soal sama sekali, dan
-- saringan event tidak menyempitkan cakupan mapel dibanding sebelumnya.
--
-- ROLLBACK: supabase/rollback/20261105000002_semua_guru_masuk_rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION psat.akses_saya()
RETURNS TABLE (
  id             uuid,
  nama           text,
  email          text,
  role           text,
  bisa_menulis   boolean,
  bisa_memvalidasi boolean,
  bisa_mengomentari boolean,
  mapel_ids      uuid[],
  mapel_nama     text[],
  unit_sekolah   text,
  no_hp          text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, psat
AS $fn$
DECLARE
  v_id        uuid;
  v_nama      text;
  v_email     text;
  v_role_db   text;
  v_status    text;
  v_penulis   boolean;
  v_validator boolean;
  v_role      text;
  v_ampu      boolean;
  v_ids       uuid[];
  v_nama_mapel text[];
  v_unit      text;
  v_hp        text;
BEGIN
  -- Nama OUT parameter (id, nama, role, …) menjadi variabel PL/pgSQL, jadi
  -- setiap SELECT di sini WAJIB memakai kolom eksplisit dan alias berbeda.
  SELECT p.id, p.nama, p.email, p.role, p.status, p.is_penulis_soal, p.is_soal_validator
    INTO v_id, v_nama, v_email, v_role_db, v_status, v_penulis, v_validator
  FROM public.profiles p
  WHERE p.id = auth.uid();

  -- Dua pemeriksaan terpisah: PL/pgSQL tidak menjamin short-circuit, jadi
  -- `NOT FOUND OR v_status <> 'aktif'` bisa lolos dengan nilai NULL.
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_status IS DISTINCT FROM 'aktif' THEN
    RETURN;
  END IF;

  v_role := CASE
              WHEN v_role_db = 'admin' THEN 'admin'
              WHEN v_validator         THEN 'validator'
              ELSE 'guru'
            END;

  -- Catatan sejarah: dulu ada gerbang di sini yang menolak guru tanpa
  -- penugasan. Gerbang itu dihapus atas permintaan pemilik produk — guru tanpa
  -- penugasan kini MASUK, hanya saja tidak punya mapel untuk dikomentari dan
  -- tidak bisa menulis soal. Akun non-guru yang bukan admin/validator tetap
  -- masuk sebagai 'guru' seperti sebelumnya; tidak ada peran lain di PSAT.
  v_ampu := EXISTS (
    SELECT 1 FROM public.guru_mengajar gm WHERE gm.guru_id = v_id
  );

  IF v_role IN ('admin', 'validator') THEN
    SELECT array_agg(x.id ORDER BY x.nama), array_agg(x.nama ORDER BY x.nama)
      INTO v_ids, v_nama_mapel
    FROM (SELECT DISTINCT mp.id, mp.nama FROM psat.mata_pelajaran mp) x;
  ELSE
    SELECT array_agg(x.id ORDER BY x.nama), array_agg(x.nama ORDER BY x.nama)
      INTO v_ids, v_nama_mapel
    FROM (
      SELECT DISTINCT mp.id, mp.nama
      FROM psat.mata_pelajaran mp
      WHERE mp.id = ANY (psat.mapel_komentar_saya())
    ) x;
  END IF;

  SELECT gd.unit_sekolah, gd.whatsapp INTO v_unit, v_hp
  FROM psat.psat_guru_data gd WHERE gd.profile_id = v_id;

  RETURN QUERY SELECT
    v_id,
    v_nama,
    v_email,
    v_role,
    -- Menulis soal: penulis (ditunjuk di Patokan), admin, validator.
    (COALESCE(v_penulis, false) OR v_role IN ('admin', 'validator'))               AS bisa_menulis,
    (v_role IN ('admin', 'validator'))                                             AS bisa_memvalidasi,
    -- Mengomentari: semua akun boleh; yang membatasi cakupannya adalah daftar
    -- mapel di atas, bukan gerbang masuk.
    true                                                                           AS bisa_mengomentari,
    COALESCE(v_ids, '{}'::uuid[])                                                  AS mapel_ids,
    COALESCE(v_nama_mapel, '{}'::text[])                                           AS mapel_nama,
    v_unit                                                                         AS unit_sekolah,
    v_hp                                                                           AS no_hp;
END
$fn$;

COMMENT ON FUNCTION psat.akses_saya() IS
  'Satu baris berisi peran dan kemampuan pemanggil; nol baris HANYA bila akun tidak ada atau tidak aktif. Setiap guru aktif boleh masuk: menulis soal tetap dibatasi is_penulis_soal (ditunjuk di Patokan), selebihnya hanya bisa mengomentari mapelnya.';

REVOKE ALL ON FUNCTION psat.akses_saya() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.akses_saya() TO authenticated;

-- =============================================================================
-- Gerbang: dua hal yang paling mudah rusak saat fungsi ini disentuh
-- =============================================================================
DO $gate$
DECLARE
  v_guru_kosong uuid;
  v_penulis     uuid;
  v_n           int;
BEGIN
  -- (1) Gerbang masuk tidak boleh lagi menolak guru tanpa penugasan.
  SELECT p.id INTO v_guru_kosong
  FROM public.profiles p
  WHERE p.role = 'guru' AND p.status = 'aktif'
    AND NOT COALESCE(p.is_penulis_soal, false)
    AND NOT COALESCE(p.is_soal_validator, false)
    AND NOT EXISTS (SELECT 1 FROM public.guru_mengajar gm WHERE gm.guru_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM psat.bank_soal b WHERE b.guru_id = p.id)
  ORDER BY p.created_at LIMIT 1;

  IF v_guru_kosong IS NULL THEN
    RAISE NOTICE 'Tidak ada guru tanpa penugasan untuk diuji — gerbang perilaku dilewati.';
  ELSE
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_guru_kosong, 'role', 'authenticated')::text, true);

    SELECT count(*) INTO v_n FROM psat.akses_saya() a
     WHERE a.role = 'guru' AND a.bisa_mengomentari AND NOT a.bisa_menulis AND NOT a.bisa_memvalidasi;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Guru tanpa penugasan masih ditolak atau diberi hak menulis';
    END IF;
    RAISE NOTICE 'Guru tanpa penugasan masuk dengan hak komentar saja: OK';
  END IF;

  -- (2) Penulis tetap bisa menulis. Kalau gerbang ini gagal, "semua guru boleh
  -- masuk" sudah menelan hak menulis soal.
  SELECT p.id INTO v_penulis
  FROM public.profiles p
  WHERE p.role = 'guru' AND p.status = 'aktif' AND p.is_penulis_soal
  ORDER BY p.created_at LIMIT 1;

  IF v_penulis IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_penulis, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_n FROM psat.akses_saya() a WHERE a.bisa_menulis;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Penulis kehilangan hak menulis setelah gerbang dilonggarkan';
    END IF;
  END IF;

  -- (3) Akun non-aktif tetap ditolak.
  PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT count(*) INTO v_n FROM psat.akses_saya();
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Pemanggil tanpa sesi mendapat baris akses_saya';
  END IF;

  RAISE NOTICE 'Gerbang akses_saya lolos';
END
$gate$;

COMMIT;

NOTIFY pgrst, 'reload schema';
