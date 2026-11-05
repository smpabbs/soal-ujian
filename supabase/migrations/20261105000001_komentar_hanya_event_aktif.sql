-- Migration: soal yang bisa dikomentari hanya milik event ujian yang AKTIF
--
-- MASALAH
-- get_soal_komentator() mengembalikan SEMUA soal pada satu mapel, lintas event
-- dan lintas tahun. Diukur 5 Nov 2026: 4.539 soal terkumpul di tiga event dan
-- hanya satu event yang aktif, serta event aktif itu belum punya soal sama
-- sekali. Artinya guru pengampu melihat tumpukan kerja tahun lalu yang sudah
-- selesai, dan setiap siklus baru ikut "menempel" di daftar yang sama.
--
-- APA YANG BERUBAH
-- Daftar soal kini disaring lewat psat.get_ujian_aktif() — DEFINISI YANG SAMA
-- dengan halaman Matrix, Soal, dashboard, dan antrean validasi. Ini penting:
-- kalau di sini dipakai definisi lain ("is_active saja"), guru akan melihat
-- daftar komentar untuk ujian yang tidak muncul di tempat lain, atau sebaliknya.
--
-- APA YANG TIDAK BERUBAH
--   * Komentar yang SUDAH ditulis tidak dihapus. Ketika event aktif lagi, utas
--     lamanya kembali terlihat. Menghapusnya berarti menghapus jejak diskusi.
--   * get_komentar_soal(soal_id) tetap membuka soal apa pun yang diizinkan
--     boleh_komentar_soal() — balasan penulis tidak boleh putus hanya karena
--     event berganti di tengah percakapan.
--   * Mapel yang ditawarkan di layar (akses_saya → mapel_ids) ikut disaring,
--     supaya tidak ada tombol mapel yang membuka daftar kosong.
--
-- ROLLBACK: supabase/rollback/20261105000001_komentar_hanya_event_aktif_rollback.sql

BEGIN;

-- =============================================================================
-- 1. Mapel yang punya soal pada event aktif
-- =============================================================================
-- Tanpa ini guru pengampu tetap melihat tombol mapel yang, begitu diklik,
-- kosong — persis mode gagal yang sudah berkali-kali menggigit di proyek ini.

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
  ) x
  -- Hanya mapel yang benar-benar punya soal di event aktif yang ditawarkan.
  -- Kalau tidak ada event aktif sama sekali (keadaan hari ini), hasilnya
  -- kosong — dan layar komentar berkata jujur, bukan menampilkan ribuan soal
  -- tahun lalu.
  WHERE EXISTS (
    SELECT 1
    FROM psat.bank_soal b
    JOIN psat.get_ujian_aktif() a ON a.ujian_id = b.ujian_id
    WHERE b.mata_pelajaran_id = x.id
  );
$fn$;

COMMENT ON FUNCTION psat.mapel_komentar_saya() IS
  'Mapel PSAT yang boleh dibaca/dikomentari pemanggil (diampu menurut guru_mengajar + mapel tempat ia menulis), dibatasi pada mapel yang punya soal di event ujian AKTIF.';

REVOKE ALL ON FUNCTION psat.mapel_komentar_saya() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.mapel_komentar_saya() TO authenticated;

-- =============================================================================
-- 2. akses_saya(): gerbang masuk tidak boleh ikut mati
-- =============================================================================
-- Dulu bisa_mengomentari dan daftar mapel diturunkan dari mapel_komentar_saya()
-- yang sekarang mungkin kosong. Kalau dibiarkan, setiap guru pengampu akan
-- ditolak di dashboard ("belum diberi akses") hanya karena event dipergantian.
-- Karena itu hak dasarnya tetap dihitung dari penugasan, sedangkan daftar
-- mapel — yang memang boleh kosong — memakai hasil saringan event aktif.
--
-- Catatan: nama OUT parameter (id, nama, role, …) menjadi variabel PL/pgSQL,
-- jadi setiap SELECT di sini WAJIB memakai kolom eksplisit dan alias berbeda.

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

  -- Guru pengampu dihitung dari PENUGASAN, tidak dari daftar mapel ber-event
  -- aktif. Tanpa ini, guru yang sah kehilangan akunnya setiap kali event
  -- berganti.
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

  -- Guru tanpa penugasan, tanpa flag, dan tanpa mapel ber-event aktif tidak
  -- punya alasan masuk.
  IF v_role = 'guru'
     AND NOT COALESCE(v_penulis, false)
     AND NOT v_ampu
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
       OR v_ampu)                                                                  AS bisa_mengomentari,
    COALESCE(v_ids, '{}'::uuid[])                                                  AS mapel_ids,
    COALESCE(v_nama_mapel, '{}'::text[])                                           AS mapel_nama,
    v_unit                                                                         AS unit_sekolah,
    v_hp                                                                           AS no_hp;
END
$fn$;

COMMENT ON FUNCTION psat.akses_saya() IS
  'Satu baris berisi peran dan kemampuan pemanggil; nol baris bila tidak berhak masuk PSAT. Hak mengomentari dihitung dari penugasan; mapel yang ditawarkan hanya yang punya soal di event AKTIF.';

REVOKE ALL ON FUNCTION psat.akses_saya() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.akses_saya() TO authenticated;

-- =============================================================================
-- 3. Daftar soal: hanya ujian ber-event aktif
-- =============================================================================
-- Bentuk kolom TIDAK berubah, jadi klien lama tetap jalan. Satu-satunya
-- perubahan adalah JOIN ke get_ujian_aktif().

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
  -- sudah menulis soal di mapel itu. Gunakan isi daftar TANPA saringan event
  -- (lihat get_komentar_soal): yang membatasi siklus hanya daftar soalnya.
  IF NOT COALESCE(v_staf, false)
     AND NOT psat.saya_mengampu_mapel(p_mapel_id)
     AND NOT EXISTS (
       SELECT 1 FROM psat.bank_soal b
       WHERE b.mata_pelajaran_id = p_mapel_id AND b.guru_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'Anda tidak mengampu mata pelajaran ini.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.mata_pelajaran_id,
    mp.nama,
    b.ujian_id,
    a.ujian_nama,
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
  -- INNER JOIN yang menentukan siklus: soal dari event lain tidak ikut.
  JOIN psat.get_ujian_aktif() a ON a.ujian_id = b.ujian_id
  JOIN psat.mata_pelajaran mp ON mp.id = b.mata_pelajaran_id
  WHERE b.mata_pelajaran_id = p_mapel_id
  ORDER BY a.ujian_nama, b.created_at;
END
$fn$;

COMMENT ON FUNCTION psat.get_soal_komentator(uuid) IS
  'Soal satu mapel untuk layar komentar — HANYA dari ujian ber-event AKTIF (definisi psat.get_ujian_aktif()), semua status termasuk draft dan approved.';

REVOKE ALL ON FUNCTION psat.get_soal_komentator(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION psat.get_soal_komentator(uuid) TO authenticated;

-- =============================================================================
-- 4. Gerbang
-- =============================================================================
-- Dijalankan di dalam transaksi migrasi. Yang deterministik saja: bentuk kolom
-- tetap, dan daftar soal tidak memuat ujian dari event tidak aktif. Perilaku
-- per-pengguna diuji terpisah sebagai peran `authenticated`.

DO $gate$
DECLARE
  v_n_aktif int;
  v_bocor   int;
  v_kolom   int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('psat.get_soal_komentator(uuid)')
      AND pg_get_functiondef(p.oid) LIKE '%get_ujian_aktif() a ON a.ujian_id = b.ujian_id%'
  ) THEN
    RAISE EXCEPTION 'get_soal_komentator tidak lagi menyaring lewat get_ujian_aktif()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('psat.mapel_komentar_saya()')
      AND pg_get_functiondef(p.oid) LIKE '%get_ujian_aktif() a ON a.ujian_id = b.ujian_id%'
  ) THEN
    RAISE EXCEPTION 'mapel_komentar_saya tidak menyaring mapel lewat event aktif';
  END IF;

  -- Bentuk kolom tidak boleh berubah: klien sudah menerima 21 kolom ini.
  -- Diukur dari pg_proc, bukan information_schema.parameters — di database ini
  -- informasi_schema mengembalikan 0 baris untuk tipe RETURN TABLE. proargnames
  -- juga memuat nama argumen MASUK (p_mapel_id), jadi argumen masuk dihitung
  -- terpisah lewat pronargs.
  SELECT count(*)
    INTO v_kolom
  FROM unnest(
    (SELECT p.proargnames FROM pg_proc p WHERE p.oid = to_regprocedure('psat.get_soal_komentator(uuid)'))
  ) WITH ORDINALITY AS t(nama, pos)
  WHERE pos > (SELECT p.pronargs FROM pg_proc p WHERE p.oid = to_regprocedure('psat.get_soal_komentator(uuid)'));
  IF v_kolom <> 21 THEN
    RAISE EXCEPTION 'Bentuk kolom get_soal_komentator berubah (% kolom, harus 21) — klien lama akan patah', v_kolom;
  END IF;

  SELECT count(*) INTO v_n_aktif FROM psat.get_ujian_aktif();
  IF v_n_aktif = 0 THEN
    RAISE NOTICE 'Tidak ada ujian ber-event aktif; saringan tidak bisa diuji sekarang (layar komentar akan kosong sampai event diaktifkan).';
    RETURN;
  END IF;

  -- Soal milik event TIDAK aktif tidak boleh muncul lewat fungsi ini.
  SELECT count(*) INTO v_bocor
  FROM psat.bank_soal b
  JOIN public.ujian u ON u.id = b.ujian_id
  JOIN public.event_ujian ev ON ev.id = u.event_id
  WHERE NOT ev.is_active
    AND b.id IN (SELECT s.id FROM psat.get_soal_komentator(b.mata_pelajaran_id) s);
  IF v_bocor <> 0 THEN
    RAISE EXCEPTION '% soal dari event tidak aktif bocor ke daftar komentar', v_bocor;
  END IF;

  RAISE NOTICE 'Gerbang lolos: % ujian ber-event aktif, 0 soal event lain bocor', v_n_aktif;
END
$gate$;

COMMIT;

NOTIFY pgrst, 'reload schema';
