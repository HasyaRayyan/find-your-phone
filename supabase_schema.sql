-- Pastikan RLS aktif agar Supabase tidak menampilkan peringatan
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

-- Hapus kebijakan lama (jika masih nyangkut)
DROP POLICY IF EXISTS "Users can insert their own devices" ON devices;
DROP POLICY IF EXISTS "Users can view their own devices" ON devices;
DROP POLICY IF EXISTS "Users can update their own devices" ON devices;
DROP POLICY IF EXISTS "Users can delete their own devices" ON devices;

-- Buat satu kebijakan super yang mengizinkan SIAPA SAJA untuk menambah, melihat, dan mengubah data (tanpa login)
CREATE POLICY "Allow public access" ON devices FOR ALL USING (true) WITH CHECK (true);
