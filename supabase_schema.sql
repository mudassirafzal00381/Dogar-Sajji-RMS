-- ══════════════════════════════════════════════════════════════════════════════
-- EDEN CRUST PIZZA — SUPABASE POSTGRESQL SCHEMA & MENU DATA
-- Copy and paste this entire script into Supabase SQL Editor (https://supabase.com)
-- ==============================================================================
-- SEED DOGAR SAJJI MENU DATA
-- ==============================================================================

INSERT INTO public.menu_categories (name) VALUES
  ('Sajji With Rice (چاول کے ساتھ)'),
  ('Sajji Without Rice (چاول کے بغیر)'),
  ('Rice Sides (چاول)'),
  ('Raita & Salads (رائتہ)'),
  ('Cold Drinks & Water (کولڈ ڈرنکس)')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.menu_items (id, name, cat, price, discount, desc_text, img, available, variants) VALUES
  (1, 'Full Sajji with Rice (فل سجی باچاول)', 'Sajji With Rice (چاول کے ساتھ)', 1950, 0, 'Delicious full roasted chicken sajji served with aromatic rice', 'assets/items/sajji_rice.jpg', true, '[]'::jsonb),
  (2, 'Half Sajji with Rice (ہاف سجی باچاول)', 'Sajji With Rice (چاول کے ساتھ)', 1050, 0, 'Half roasted chicken sajji served with aromatic rice', 'assets/items/sajji_rice.jpg', true, '[]'::jsonb),
  (3, 'Quarter Sajji with Rice (کوارٹر سجی باچاول)', 'Sajji With Rice (چاول کے ساتھ)', 600, 0, 'Quarter roasted chicken sajji served with aromatic rice', 'assets/items/sajji_rice.jpg', true, '[]'::jsonb),
  (4, 'Full Sajji without Rice (فل سجی بغیر چاول)', 'Sajji Without Rice (چاول کے بغیر)', 1600, 0, 'Traditional full roasted chicken sajji', 'assets/items/sajji_chicken.jpg', true, '[]'::jsonb),
  (5, 'Half Sajji without Rice (ہاف سجی بغیر چاول)', 'Sajji Without Rice (چاول کے بغیر)', 800, 0, 'Traditional half roasted chicken sajji', 'assets/items/sajji_chicken.jpg', true, '[]'::jsonb),
  (6, 'Quarter Sajji without Rice (کوارٹر سجی بغیر چاول)', 'Sajji Without Rice (چاول کے بغیر)', 400, 0, 'Traditional quarter roasted chicken sajji', 'assets/items/sajji_chicken.jpg', true, '[]'::jsonb),
  (7, 'Full Rice (فل چاول)', 'Rice Sides (چاول)', 400, 0, 'Full portion of specially seasoned sajji rice', 'assets/items/rice_side.jpg', true, '[]'::jsonb),
  (8, 'Half Rice (ہاف چاول)', 'Rice Sides (چاول)', 250, 0, 'Half portion of specially seasoned sajji rice', 'assets/items/rice_side.jpg', true, '[]'::jsonb),
  (9, 'Fresh Raita (رائتہ)', 'Raita & Salads (رائتہ)', 70, 0, 'Fresh mint & zeera raita', 'assets/items/raita.jpg', true, '[]'::jsonb),
  (10, 'Half Mineral Water (ہاف واٹر)', 'Cold Drinks & Water (کولڈ ڈرنکس)', 60, 0, '500ml Mineral Water', 'assets/items/drinks.jpg', true, '[]'::jsonb),
  (11, 'Full Mineral Water (فل واٹر)', 'Cold Drinks & Water (کولڈ ڈرنکس)', 120, 0, '1.5 Liter Mineral Water', 'assets/items/drinks.jpg', true, '[]'::jsonb),
  (12, 'Drink (1.5 Liter)', 'Cold Drinks & Water (کولڈ ڈرنکس)', 210, 0, '1.5 Liter Chilled Soft Drink', 'assets/items/drinks.jpg', true, '[]'::jsonb),
  (13, 'Drink (1 Liter)', 'Cold Drinks & Water (کولڈ ڈرنکس)', 170, 0, '1.0 Liter Chilled Soft Drink', 'assets/items/drinks.jpg', true, '[]'::jsonb),
  (14, 'Drink (NR Regular)', 'Cold Drinks & Water (کولڈ ڈرنکس)', 80, 0, 'Regular NR Chilled Beverage', 'assets/items/drinks.jpg', true, '[]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, cat = EXCLUDED.cat, price = EXCLUDED.price,
  desc_text = EXCLUDED.desc_text, img = EXCLUDED.img, available = EXCLUDED.available;
