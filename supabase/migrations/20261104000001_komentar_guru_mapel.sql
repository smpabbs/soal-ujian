-- Migration: guru pengampu mapel boleh masuk dan mengomentari soal
--
-- MASALAH
-- Sejak identitas PSAT disatukan dengan LMS (lms-new 20260821_psat_identitas_bersama),
-- pintu masuk PSAT dijaga dua flag: public.profiles.is_penulis_soal dan
-- is_soal_validator. Guru yang mengampu mapel tetapi tidak ditunjuk sebagai
-- penulis soal mendapat psat.current_user_role() = NULL, sehingga view
-- psat.profiles mengembalikan nol baris dan dashboard menampilkan layar
-- "Akun Anda belum diberi akses".
--
-- Padahal justru guru mapel yang sama yang paling tahu apakah soal rekannya
-- layak dipakai. Mereka perlu bisa masuk untuk MEMBACA dan MENGOMENTARI soal
-- di mapel yang mereka ampu — tanpa diberi hak menulis, memvalidasi, atau
-- mengubah soal.
--
-- YANG DIBUKA
--   * Guru aktif yang punya minimal satu baris public.guru_mengajar boleh masuk.
--   * Ia hanya bisa melihat soal (dan komentarnya) pada mapel yang ia ampu,
--     dipetakan lewat psat.mapel_alias seperti RPC lain.
--   * Semua status soal boleh dikomentari, termasuk draft dan approved.
--     Draft: umpan balik masih bisa ditindaklanjuti sebelum dikirim.
--     Approved: soal sudah terkunci, komentar adalah satu-satunya jalur koreksi.
--   * Kunci jawaban ikut terlihat oleh guru mapel yang sama; ini bukan data
--     publik, dan tanpa kunci komentar tidak bisa menilai kebenaran soal.
--
-- YANG TIDAK DIUBAH
--   * psat.current_user_role() tetap NULL untuk guru non-penulis. Semua policy
--     tulis yang bergantung padanya (matrix, patokan, dokumen, validasi) tetap
--     menolak. Komentar punya RPC dan policy sendiri.
--   * psat.profiles dan psat.profiles_all tidak disentuh. Halaman publik yang
--     memakai profiles_all tidak ikut menampilkan ratusan guru tanpa soal.
--     Dashboard memakai psat.akses_saya() sebagai gerbang, bukan view itu.
--
-- ROLLBACK: supabase/rollback/20261104000001_komentar_guru_mapel_rollback.sql

BEGIN;

-- =============================================================================
-- 1. Siapa yang mengampu mapel apa
-- =============================================================================
-- Dipakai policy dan RPC. SECURITY DEFINER karena public.guru_mengajar milik
-- LMS dan RLS-nya tidak menjamin guru bisa membaca barisnya sendiri di dalam
-- subquery policy.

CREATE OR REPLACE FUNCTION psat.saya_mengampu_mapel(p_psat_mapel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, psat
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.guru_mengajar gm ON gm.guru_id = p.id
    LEFT JOIN psat.mapel_alias ma ON ma.public_mapel_id = gm.mapel_id
    WHERE p.id = auth.uid()
      AND p.status = 'aktif'
      AND p.role = 'guru'
      -- COALESCE: mapel yang belum punya baris alias tetap cocok bila id-nya
      -- sama di kedua schema (keadaan normal untuk mapel baru).
      AND COALESCE(ma.psat_mapel_id, gm.mapel_id) = p_psat_mapel_id
  );
$fn$;

COMMENT ON FUNCTION psat.saya_mengampu_mapel(uuid) IS
  'True bila pemanggil guru aktif yang mengampu mapel PSAT tersebut menurut public.guru_mengajar (dipetakan lewat psat.mapel_alias).';

REVOKE ALL ON FUNCTION psat.saya_mengampu_mapel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.saya_mengampu_mapel(uuid) TO authenticated;

-- 1b ── Daftar mapel yang boleh dibaca/dikomentari pemanggil ──────────────────
-- Dipakai akses_saya() dan get_soal_komentator(). Dua sumber digabung:
--   (a) mapel yang diampu menurut public.guru_mengajar (lewat mapel_alias),
--   (b) mapel tempat ia sudah menulis soal — penugasan bisa dicabut sementara
--       soalnya tetap ada, dan komentarnya tetap perlu dijawab.
-- Tanpa sumber (b), guru yang kehilangan penugasan melihat ujiannya di
-- get_soal_komentator tetapi tidak bisa memilihnya di layar komentar.

CREATE OR REPLACE FUNCTION psat.mapel_komentar_saya()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, psat
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT x.id), '{}'::uuid[])
  FROM (
    SELECT COALESCE(ma.psat_mapel_id, gm.mapel_id) AS id
    FROM public.guru_mengajar gm
    LEFT JOIN psat.mapel_alias ma ON ma.public_mapel_id = gm.mapel_id
    WHERE gm.guru_id = auth.uid()
    UNION
    SELECT b.mata_pelajaran_id
    FROM psat.bank_soal b
    WHERE b.guru_id = auth.uid() AND b.mata_pelajaran_id IS NOT NULL
  ) x;
$fn$;

COMMENT ON FUNCTION psat.mapel_komentar_saya() IS
  'Mapel PSAT yang boleh dibaca/dikomentari pemanggil: yang ia ampu (menurut guru_mengajar) digabung mapel tempat ia sudah menulis soal.';

REVOKE ALL ON FUNCTION psat.mapel_komentar_saya() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.mapel_komentar_saya() TO authenticated;

CREATE OR REPLACE FUNCTION psat.saya_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, psat
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'aktif'
      AND p.role = 'admin'
  );
$fn$;

COMMENT ON FUNCTION psat.saya_admin() IS
  'True bila pemanggil admin aktif. Dipakai policy hapus komentar — bukan untuk membuka fitur lain.';

REVOKE ALL ON FUNCTION psat.saya_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.saya_admin() TO authenticated;

-- =============================================================================
-- 2. Gerbang login: akses_saya()
-- =============================================================================
-- Menggantikan ketergantungan dashboard pada view psat.profiles. View itu tetap
-- benar untuk penulis/validator/admin; yang salah adalah memakainya sebagai
-- SATU-SATUNYA gerbang, karena guru pengampu sengaja tidak masuk ke sana.
--
-- Mengembalikan NOL baris bila pemanggil tidak berhak masuk sama sekali —
-- bentuk yang sama dengan "tidak ada profil" yang sudah dikenal dashboard.

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
  -- Rekaman profil, bukan public.profiles%ROWTYPE: gunakan hanya kolom yang
  -- benar-benar dibaca, dan semuanya diambil dengan nama kolom eksplisit.
  v_id     uuid;
  v_nama   text;
  v_email  text;
  v_role_db text;
  v_status text;
  v_penulis   boolean;
  v_validator boolean;
  v_role  text;
  v_ids   uuid[];
  v_nama_mapel  text[];
  v_unit  text;
  v_hp    text;
BEGIN
  -- Kolom ditulis eksplisit, bukan `SELECT *`: nama OUT parameter fungsi ini
  -- (id, nama, email, role, …) menjadi variabel PL/pgSQL, sehingga `WHERE id = …`
  -- di dalam fungsi RETURNS TABLE berujung "column reference id is ambiguous".
  SELECT p.id, p.nama, p.email, p.role, p.status, p.is_penulis_soal, p.is_soal_validator
    INTO v_id, v_nama, v_email, v_role_db, v_status, v_penulis, v_validator
  FROM public.profiles p
  WHERE p.id = auth.uid();

  -- Dua pemeriksaan terpisah, bukan satu OR: PL/pgSQL tidak menjamin
  -- short-circuit, dan `NOT FOUND OR v_status <> 'aktif'` akan lolos dengan
  -- nilai NULL kalau evaluasinya dibalik.
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_status IS DISTINCT FROM 'aktif' THEN
    RETURN;
  END IF;

  v_role := CASE
              WHEN v_role_db = 'admin'     THEN 'admin'
              WHEN v_validator             THEN 'validator'
              ELSE 'guru'
            END;

  -- Admin & validator boleh menelusuri semua mapel untuk moderasi komentar.
  -- Guru hanya mapel yang ia ampu atau tempat ia sudah menulis soal.
  IF v_role IN ('admin', 'validator') THEN
    SELECT array_agg(x.id ORDER BY x.nama), array_agg(x.nama ORDER BY x.nama)
      INTO v_ids, v_nama_mapel
    FROM (SELECT DISTINCT mp.id, mp.nama FROM psat.mata_pelajaran mp) x;
  ELSE
    -- Nama tidak dibagi dua aggregat (array_agg DISTINCT dua kolom tidak sah).
    -- Dua array paralel cukup: keduanya diurutkan menurut nama yang sama.
    SELECT array_agg(x.id ORDER BY x.nama), array_agg(x.nama ORDER BY x.nama)
      INTO v_ids, v_nama_mapel
    FROM (
      SELECT DISTINCT mp.id, mp.nama
      FROM psat.mata_pelajaran mp
      WHERE mp.id = ANY (psat.mapel_komentar_saya())
    ) x;
  END IF;

  -- Guru tanpa penugasan mapel dan tanpa flag penulis tidak punya alasan masuk.
  IF v_role = 'guru'
     AND NOT COALESCE(v_penulis, false)
     AND COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  SELECT gd.unit_sekolah, gd.whatsapp INTO v_unit, v_hp
  FROM psat.psat_guru_data gd WHERE gd.profile_id = v_id;

  RETURN QUERY SELECT
    v_id,
    v_nama,
    v_email,
    v_role,
    (COALESCE(v_penulis, false) OR v_role IN ('admin', 'validator'))               AS bisa_menulis,
    (v_role IN ('admin', 'validator'))                                             AS bisa_memvalidasi,
    (v_role IN ('admin', 'validator')
       OR COALESCE(v_penulis, false)
       OR COALESCE(array_length(v_ids, 1), 0) > 0)                                 AS bisa_mengomentari,
    COALESCE(v_ids, '{}'::uuid[])                                                  AS mapel_ids,
    COALESCE(v_nama_mapel, '{}'::text[])                                           AS mapel_nama,
    v_unit                                                                         AS unit_sekolah,
    v_hp                                                                           AS no_hp;
END
$fn$;

COMMENT ON FUNCTION psat.akses_saya() IS
  'Satu baris berisi peran dan kemampuan pemanggil; nol baris bila tidak berhak masuk PSAT. Guru aktif yang mengampu mapel mendapat bisa_mengomentari tanpa harus jadi penulis soal.';

REVOKE ALL ON FUNCTION psat.akses_saya() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.akses_saya() TO authenticated;

-- =============================================================================
-- 3. Tabel komentar
-- =============================================================================

CREATE TABLE IF NOT EXISTS psat.soal_komentar (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  soal_id    uuid NOT NULL REFERENCES psat.bank_soal(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES psat.soal_komentar(id) ON DELETE CASCADE,
  penulis_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  isi        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT soal_komentar_isi_wajar CHECK (char_length(btrim(isi)) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_soal_komentar_soal   ON psat.soal_komentar(soal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_soal_komentar_parent ON psat.soal_komentar(parent_id);
CREATE INDEX IF NOT EXISTS idx_soal_komentar_orang  ON psat.soal_komentar(penulis_id);

COMMENT ON TABLE psat.soal_komentar IS
  'Komentar guru pengampu mapel pada soal. Satu tingkat balasan (parent_id menunjuk komentar utama); hapus komentar utama menghapus balasannya lewat ON DELETE CASCADE.';

-- Balasan hanya boleh satu tingkat dan harus pada soal yang sama. RPC sudah
-- memeriksa ini; trigger menjaga jalur tulis lain (termasuk PostgREST langsung).
CREATE OR REPLACE FUNCTION psat.soal_komentar_kedalaman()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = psat
AS $fn$
DECLARE
  v_induk_soal   uuid;
  v_induk_parent uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT k.soal_id, k.parent_id INTO v_induk_soal, v_induk_parent
  FROM psat.soal_komentar k WHERE k.id = NEW.parent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Komentar induk tidak ditemukan.' USING ERRCODE = '23503';
  END IF;
  IF v_induk_soal <> NEW.soal_id THEN
    RAISE EXCEPTION 'Balasan harus berada pada soal yang sama dengan komentar induknya.' USING ERRCODE = '23514';
  END IF;
  IF v_induk_parent IS NOT NULL THEN
    RAISE EXCEPTION 'Balasan hanya boleh satu tingkat.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_soal_komentar_kedalaman ON psat.soal_komentar;
CREATE TRIGGER trg_soal_komentar_kedalaman
  BEFORE INSERT OR UPDATE OF parent_id ON psat.soal_komentar
  FOR EACH ROW EXECUTE FUNCTION psat.soal_komentar_kedalaman();

ALTER TABLE psat.soal_komentar ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3b. Menutup celah tulis yang terbuka oleh pintu masuk baru
-- =============================================================================
-- Policy lama soal_insert_own hanya berbunyi `auth.uid() = guru_id`. Selama
-- gerbang login masih berdasarkan is_penulis_soal, itu cukup: yang bisa masuk
-- memang hanya penulis. Sekarang guru pengampu juga bisa masuk, dan tanpa
-- perubahan ini mereka bisa menyisipkan baris bank_soal atas namanya sendiri
-- lewat PostgREST — soal "draft" milik orang yang bukan penulis, yang kemudian
-- ikut terkirim ke validator.
--
-- UA2-nya: peran guru biasa hanya memegang tulis bila is_penulis_soal menyala.
-- Admin/validator tetap seperti sebelumnya (current_user_role() sudah memuat
-- syarat yang sama), jadi tidak ada kemampuan lama yang dicabut.

CREATE OR REPLACE FUNCTION psat.boleh_menulis_soal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, psat
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.status = 'aktif'
      AND (p.is_penulis_soal OR p.role = 'admin' OR p.is_soal_validator)
  );
$fn$;

COMMENT ON FUNCTION psat.boleh_menulis_soal() IS
  'True bila pemanggil penulis soal, admin, atau validator aktif. Menutup jalur tulis bank_soal bagi guru pengampu yang kini boleh masuk untuk berkomentar.';

REVOKE ALL ON FUNCTION psat.boleh_menulis_soal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.boleh_menulis_soal() TO authenticated;

DROP POLICY IF EXISTS "soal_insert_own" ON psat.bank_soal;
CREATE POLICY "soal_insert_own" ON psat.bank_soal
  FOR INSERT WITH CHECK (
    auth.uid() = guru_id
    AND psat.boleh_menulis_soal()
  );

DROP POLICY IF EXISTS "soal_update_own_or_staff" ON psat.bank_soal;
CREATE POLICY "soal_update_own_or_staff" ON psat.bank_soal
  FOR UPDATE USING (
    (auth.uid() = guru_id AND psat.boleh_menulis_soal())
    OR psat.current_user_role() IN ('validator', 'admin')
  );

DROP POLICY IF EXISTS "soal_delete_own_draft" ON psat.bank_soal;
CREATE POLICY "soal_delete_own_draft" ON psat.bank_soal
  FOR DELETE USING (
    auth.uid() = guru_id
    AND status = 'draft'
    AND psat.boleh_menulis_soal()
  );

-- =============================================================================
-- 4. Hak melihat & mengomentari
-- =============================================================================
-- Satu pintu untuk tiga kelompok:
--   * penulis soal itu sendiri (boleh membalas komentar pada soalnya),
--   * guru yang mengampu mapel soal tersebut,
--   * admin/validator aktif (moderasi).
-- Draft ikut terbuka bagi guru mapel yang sama — keputusan produk, bukan
-- kelalaian: guru ingin memberi masukan selagi soal masih bisa diperbaiki.

CREATE OR REPLACE FUNCTION psat.boleh_komentar_soal(p_soal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, psat
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM psat.bank_soal b
    WHERE b.id = p_soal_id
      AND (
        b.guru_id = auth.uid()
        OR psat.saya_mengampu_mapel(b.mata_pelajaran_id)
        OR EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.status = 'aktif'
            AND (p.role = 'admin' OR p.is_soal_validator)
        )
      )
  );
$fn$;

COMMENT ON FUNCTION psat.boleh_komentar_soal(uuid) IS
  'True bila pemanggil penulis soal, guru yang mengampu mapelnya, atau admin/validator aktif. Menjadi satu-satunya gerbang baca/tulis komentar.';

REVOKE ALL ON FUNCTION psat.boleh_komentar_soal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.boleh_komentar_soal(uuid) TO authenticated;

DROP POLICY IF EXISTS soal_komentar_select ON psat.soal_komentar;
DROP POLICY IF EXISTS soal_komentar_insert ON psat.soal_komentar;
DROP POLICY IF EXISTS soal_komentar_delete ON psat.soal_komentar;

CREATE POLICY soal_komentar_select ON psat.soal_komentar
  FOR SELECT USING (psat.boleh_komentar_soal(soal_id));
CREATE POLICY soal_komentar_insert ON psat.soal_komentar
  FOR INSERT WITH CHECK (
    penulis_id = auth.uid()
    AND psat.boleh_komentar_soal(soal_id)
  );

-- Tidak ada policy UPDATE: komentar tidak bisa diedit, hanya dihapus. Jejak
-- diskusi lebih jujur bila isi yang salah dihapus lalu ditulis ulang.
CREATE POLICY soal_komentar_delete ON psat.soal_komentar
  FOR DELETE USING (penulis_id = auth.uid() OR psat.saya_admin());

GRANT SELECT, INSERT, DELETE ON psat.soal_komentar TO authenticated;

-- =============================================================================
-- 5. Daftar soal yang boleh dikomentari
-- =============================================================================
-- Sengaja RPC, bukan melonggarkan policy SELECT psat.bank_soal. Guru mapel lain
-- hanya perlu kolom yang ditampilkan di layar komentar; tidak perlu akses
-- mentah ke seluruh tabel (mis. revision_history atau kolom internal lain).

-- Nama tampilan yang tetap benar untuk dua jenis akun: guru LMS (public.profiles)
-- dan akun PSAT lama yang hanya ada di arsip (profiles_legacy). Dipakai layar
-- komentar, yang harus menyebut nama guru pengampu — dan guru pengampu sengaja
-- tidak muncul di view psat.profiles maupun psat.profiles_all.
CREATE OR REPLACE FUNCTION psat.nama_pengguna(p_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, psat
AS $fn$
  SELECT COALESCE(
    (SELECT p.nama FROM public.profiles p WHERE p.id = p_id),
    (SELECT l.nama FROM psat.profiles_legacy l WHERE l.id = p_id)
  );
$fn$;

COMMENT ON FUNCTION psat.nama_pengguna(uuid) IS
  'Nama tampilan satu akun, dari public.profiles atau arsip profiles_legacy. NULL bila tidak ada di keduanya.';

REVOKE ALL ON FUNCTION psat.nama_pengguna(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.nama_pengguna(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION psat.get_soal_komentator(p_mapel_id uuid)
RETURNS TABLE (
  id                uuid,
  mapel_id          uuid,
  mapel_nama        text,
  ujian_id          uuid,
  ujian_nama        text,
  penulis_id        uuid,
  penulis_nama      text,
  bab_id_text       text,
  tipe              text,
  tingkat_kesulitan text,
  status            text,
  bobot             numeric,
  pertanyaan        text,
  gambar_url        text,
  pilihan           jsonb,
  pilihan_gambar    text[],
  jawaban_benar     jsonb,
  rubrik            jsonb,
  created_at        timestamptz,
  jumlah_komentar   bigint,
  milik_saya        boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, psat
AS $fn$
DECLARE
  v_staf boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tidak terautentikasi.' USING ERRCODE = '42501';
  END IF;

  SELECT (p.role = 'admin' OR p.is_soal_validator) INTO v_staf
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.status = 'aktif';

  -- Tiga sebab sah membuka mapel ini: staf, pengampu mapel, atau guru yang
  -- sudah menulis soal di mapel itu. Yang terakhir penting karena penugasan
  -- mengajar bisa dicabut sementara soalnya tetap ada dan komentarnya tetap
  -- perlu ditanggapi.
  IF NOT COALESCE(v_staf, false)
     AND NOT psat.saya_mengampu_mapel(p_mapel_id)
     AND NOT (p_mapel_id = ANY (psat.mapel_komentar_saya())) THEN
    RAISE EXCEPTION 'Anda tidak mengampu mata pelajaran ini.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.mata_pelajaran_id,
    mp.nama,
    b.ujian_id,
    u.nama,
    b.guru_id,
    COALESCE(psat.nama_pengguna(b.guru_id), 'Penulis'),
    b.bab_id_text,
    b.tipe,
    b.tingkat_kesulitan,
    b.status::text,
    b.bobot,
    b.pertanyaan,
    b.gambar_url,
    b.pilihan,
    b.pilihan_gambar,
    b.jawaban_benar,
    b.rubrik,
    b.created_at,
    (SELECT count(*) FROM psat.soal_komentar k WHERE k.soal_id = b.id),
    (b.guru_id = auth.uid())
  FROM psat.bank_soal b
  JOIN psat.mata_pelajaran mp ON mp.id = b.mata_pelajaran_id
  LEFT JOIN public.ujian u  ON u.id = b.ujian_id
  WHERE b.mata_pelajaran_id = p_mapel_id
  ORDER BY mp.nama, u.nama, b.created_at;
END
$fn$;

COMMENT ON FUNCTION psat.get_soal_komentator(uuid) IS
  'Soal satu mapel untuk layar komentar, termasuk draft dan approved. Hanya guru pengampu mapel itu (atau admin/validator) yang boleh memanggil.';

REVOKE ALL ON FUNCTION psat.get_soal_komentator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.get_soal_komentator(uuid) TO authenticated;

-- =============================================================================
-- 6. Baca, tulis, hapus komentar
-- =============================================================================

CREATE OR REPLACE FUNCTION psat.get_komentar_soal(p_soal_id uuid)
RETURNS TABLE (
  id          uuid,
  parent_id   uuid,
  penulis_id  uuid,
  nama        text,
  peran       text,
  isi         text,
  created_at  timestamptz,
  milik_saya  boolean,
  boleh_hapus boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, psat
AS $fn$
DECLARE
  v_admin boolean;
BEGIN
  IF NOT psat.boleh_komentar_soal(p_soal_id) THEN
    RAISE EXCEPTION 'Tidak berhak membaca komentar soal ini.' USING ERRCODE = '42501';
  END IF;

  SELECT (p.role = 'admin') INTO v_admin
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.status = 'aktif';

  RETURN QUERY
  SELECT
    k.id,
    k.parent_id,
    k.penulis_id,
    COALESCE(psat.nama_pengguna(k.penulis_id), 'Pengguna'),
    CASE
      WHEN pr.role = 'admin'      THEN 'Admin'
      WHEN pr.is_soal_validator   THEN 'Validator'
      WHEN pr.is_penulis_soal     THEN 'Penulis'
      ELSE 'Guru Pengampu'
    END,
    k.isi,
    k.created_at,
    (k.penulis_id = auth.uid()),
    (k.penulis_id = auth.uid() OR COALESCE(v_admin, false))
  FROM psat.soal_komentar k
  LEFT JOIN public.profiles pr ON pr.id = k.penulis_id
  WHERE k.soal_id = p_soal_id
  ORDER BY k.created_at;
END
$fn$;

COMMENT ON FUNCTION psat.get_komentar_soal(uuid) IS
  'Utas komentar satu soal, terurut waktu. Nama & peran ikut dikirim karena psat.profiles tidak memperlihatkan guru lain kepada guru biasa.';

REVOKE ALL ON FUNCTION psat.get_komentar_soal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.get_komentar_soal(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION psat.tambah_komentar(
  p_soal_id uuid,
  p_isi text,
  p_parent_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, psat, pg_temp
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_isi  text := btrim(COALESCE(p_isi, ''));
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Tidak terautentikasi.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_isi) = 0 THEN
    RAISE EXCEPTION 'Komentar tidak boleh kosong.' USING ERRCODE = '23514';
  END IF;
  IF char_length(v_isi) > 2000 THEN
    RAISE EXCEPTION 'Komentar terlalu panjang (maksimal 2000 karakter).' USING ERRCODE = '23514';
  END IF;
  IF NOT psat.boleh_komentar_soal(p_soal_id) THEN
    RAISE EXCEPTION 'Anda tidak berhak mengomentari soal ini.' USING ERRCODE = '42501';
  END IF;

  IF p_parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM psat.soal_komentar k
      WHERE k.id = p_parent_id
        AND k.soal_id = p_soal_id
        AND k.parent_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Balasan harus menunjuk komentar utama pada soal yang sama.' USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO psat.soal_komentar (soal_id, parent_id, penulis_id, isi)
  VALUES (p_soal_id, p_parent_id, v_uid, v_isi)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$fn$;

COMMENT ON FUNCTION psat.tambah_komentar(uuid, text, uuid) IS
  'Menulis komentar/balasan. Batas 2000 karakter dan satu tingkat balasan ditegakkan di sini, bukan hanya di UI.';

REVOKE ALL ON FUNCTION psat.tambah_komentar(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.tambah_komentar(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION psat.hapus_komentar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, psat, pg_temp
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_penulis uuid;
  v_admin  boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Tidak terautentikasi.' USING ERRCODE = '42501';
  END IF;

  SELECT k.penulis_id INTO v_penulis FROM psat.soal_komentar k WHERE k.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Komentar tidak ditemukan.' USING ERRCODE = 'P0002';
  END IF;

  SELECT (p.role = 'admin') INTO v_admin
  FROM public.profiles p
  WHERE p.id = v_uid AND p.status = 'aktif';

  IF v_penulis <> v_uid AND NOT COALESCE(v_admin, false) THEN
    RAISE EXCEPTION 'Hanya pembuat komentar atau admin yang boleh menghapus.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM psat.soal_komentar WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'dihapus', 1);
END
$fn$;

COMMENT ON FUNCTION psat.hapus_komentar(uuid) IS
  'Menghapus komentar milik sendiri atau oleh admin. Balasan ikut terhapus lewat ON DELETE CASCADE.';

REVOKE ALL ON FUNCTION psat.hapus_komentar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.hapus_komentar(uuid) TO authenticated;

-- Jumlah komentar untuk lencana di daftar soal penulis. Hanya menghitung soal
-- yang boleh dilihat pemanggil, jadi tidak membocorkan aktivitas mapel lain.
CREATE OR REPLACE FUNCTION psat.get_jumlah_komentar(p_soal_ids uuid[])
RETURNS TABLE (soal_id uuid, jumlah bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, psat
AS $fn$
  SELECT b.id, count(k.id)
  FROM psat.bank_soal b
  LEFT JOIN psat.soal_komentar k ON k.soal_id = b.id
  WHERE b.id = ANY(p_soal_ids)
    AND psat.boleh_komentar_soal(b.id)
  GROUP BY b.id;
$fn$;

COMMENT ON FUNCTION psat.get_jumlah_komentar(uuid[]) IS
  'Jumlah komentar per soal untuk soal yang boleh dilihat pemanggil. Dipakai lencana di halaman Soal penulis.';

REVOKE ALL ON FUNCTION psat.get_jumlah_komentar(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.get_jumlah_komentar(uuid[]) TO authenticated;

-- =============================================================================
-- 7. Gerbang assertion
-- =============================================================================
-- Dijalankan di dalam transaksi migrasi, jadi semua tulisan uji ikut batal saat
-- COMMIT berikutnya. Yang diuji di sini hanya yang DETERMINISTIK: bentuk tabel,
-- fungsi, policy, dan perilaku RPC untuk guru pengampu.
--
-- ⚠️ Policy bank_soal TIDAK diuji di sini dengan INSERT. Di database ini
-- psat.bank_soal ber-RLS tapi rowsecurity tidak menggigit bagi route
-- Management API (diukur 5 Nov 2026: INSERT atas nama guru pengampu diterima
-- tanpa galat, sementara SELECT lewat policy yang sama menyaring ke 0 baris).
-- Karena itu uji policy dijalankan terpisah dengan SET ROLE authenticated —
-- lihat docs/MEMORY.md, bagian "Verifikasi".
--
-- Fixture dicari dinamis; di database kosong gerbang perilaku dilewati dengan
-- NOTICE supaya migrasi tetap bisa dijalankan di lingkungan baru.

DO $gate$
DECLARE
  v_guru      uuid;
  v_soal      uuid;
  v_soal_lain uuid;
  v_json      jsonb;
  v_id        uuid;
  v_n         int;
  v_ditolak   boolean;
BEGIN
  IF to_regclass('psat.soal_komentar') IS NULL THEN
    RAISE EXCEPTION 'Tabel psat.soal_komentar tidak terbentuk';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'psat' AND c.relname = 'soal_komentar' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS psat.soal_komentar tidak aktif';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'psat' AND tablename = 'soal_komentar') <> 3 THEN
    RAISE EXCEPTION 'Policy psat.soal_komentar tidak lengkap (harus 3)';
  END IF;
  IF to_regprocedure('psat.akses_saya()') IS NULL
     OR to_regprocedure('psat.mapel_komentar_saya()') IS NULL
     OR to_regprocedure('psat.boleh_komentar_soal(uuid)') IS NULL
     OR to_regprocedure('psat.boleh_menulis_soal()') IS NULL
     OR to_regprocedure('psat.get_soal_komentator(uuid)') IS NULL
     OR to_regprocedure('psat.get_komentar_soal(uuid)') IS NULL
     OR to_regprocedure('psat.tambah_komentar(uuid,text,uuid)') IS NULL
     OR to_regprocedure('psat.hapus_komentar(uuid)') IS NULL
     OR to_regprocedure('psat.get_jumlah_komentar(uuid[])') IS NULL
     OR to_regprocedure('psat.nama_pengguna(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Satu atau lebih fungsi komentar tidak terbentuk';
  END IF;

  -- Kalau kalimat ini hilang dari policy, guru pengampu kembali bisa menulis
  -- soal. Gerbang ini membaca definisi policy, bukan mengujinya.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'psat' AND tablename = 'bank_soal'
      AND policyname = 'soal_insert_own'
      AND with_check LIKE '%boleh_menulis_soal%'
  ) THEN
    RAISE EXCEPTION 'Policy soal_insert_own tidak memakai psat.boleh_menulis_soal()';
  END IF;

  SELECT p.id INTO v_guru
  FROM public.profiles p
  WHERE p.role = 'guru'
    AND p.status = 'aktif'
    AND NOT p.is_penulis_soal
    AND NOT p.is_soal_validator
    AND EXISTS (SELECT 1 FROM public.guru_mengajar gm WHERE gm.guru_id = p.id)
  ORDER BY p.created_at
  LIMIT 1;

  IF v_guru IS NULL THEN
    RAISE NOTICE 'Tidak ada guru pengampu untuk diuji; gerbang perilaku dilewati.';
    RETURN;
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_guru, 'role', 'authenticated')::text,
    true
  );

  SELECT count(*) INTO v_n
  FROM psat.akses_saya() a
  WHERE a.role = 'guru' AND NOT a.bisa_menulis AND NOT a.bisa_memvalidasi AND a.bisa_mengomentari;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'akses_saya untuk guru pengampu tidak sesuai (masuk, komentar saja)';
  END IF;

  SELECT b.id INTO v_soal
  FROM psat.bank_soal b
  WHERE b.mata_pelajaran_id = ANY (psat.mapel_komentar_saya())
  LIMIT 1;

  IF v_soal IS NULL THEN
    RAISE NOTICE 'Tidak ada soal pada mapel guru uji; uji tulis komentar dilewati.';
    RETURN;
  END IF;

  SELECT psat.tambah_komentar(v_soal, 'uji gerbang migrasi komentar', NULL) INTO v_json;
  v_id := (v_json->>'id')::uuid;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'tambah_komentar tidak mengembalikan id';
  END IF;

  SELECT count(*) INTO v_n FROM psat.get_komentar_soal(v_soal) k WHERE k.id = v_id;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Komentar yang baru ditulis tidak terbaca kembali';
  END IF;

  -- Guru yang sama tidak boleh membaca komentar soal mapel yang tidak ia ampu
  -- dan tempat ia tidak pernah menulis.
  SELECT b.id INTO v_soal_lain
  FROM psat.bank_soal b
  WHERE b.mata_pelajaran_id IS NOT NULL
    AND NOT (b.mata_pelajaran_id = ANY (psat.mapel_komentar_saya()))
  LIMIT 1;

  IF v_soal_lain IS NOT NULL THEN
    v_ditolak := false;
    BEGIN
      PERFORM psat.get_komentar_soal(v_soal_lain);
    EXCEPTION WHEN OTHERS THEN
      -- get_komentar_soal menolak dengan ERRCODE 42501 (bukan P0001), jadi
      -- penangkapnya harus OTHERS — `WHEN raise_exception` akan melewatkannya
      -- dan migrasi gagal justru karena gerbangnya bekerja.
      v_ditolak := true;
    END;
    IF NOT v_ditolak THEN
      RAISE EXCEPTION 'Guru bisa membaca komentar soal mapel yang tidak ia ampu';
    END IF;
  END IF;

  PERFORM psat.hapus_komentar(v_id);
  SELECT count(*) INTO v_n FROM psat.soal_komentar WHERE id = v_id;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'hapus_komentar tidak benar-benar menghapus';
  END IF;

  RAISE NOTICE 'Gerbang komentar lolos untuk guru %', v_guru;
END
$gate$;

COMMIT;

NOTIFY pgrst, 'reload schema';
