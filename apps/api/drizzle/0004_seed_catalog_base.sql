-- Custom SQL migration file, put your code below! ---- Divisiones internas de AlphaShook Corporation (organizaciones del ecosistema).
INSERT INTO "organizations" ("slug", "name", "kind") VALUES
  ('alphashook-studios', 'AlphaShook Studios', 'internal'),
  ('alphashook-digital', 'AlphaShook Digital', 'internal'),
  ('alphashook-technologies', 'AlphaShook Technologies', 'internal'),
  ('alphashook-interactive', 'AlphaShook Interactive', 'internal')
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
-- Categorías base del catálogo (editables luego desde administración).
INSERT INTO "categories" ("slug", "name") VALUES
  ('accion', 'Acción'), ('aventura', 'Aventura'), ('rpg', 'Rol (RPG)'), ('estrategia', 'Estrategia'),
  ('simulacion', 'Simulación'), ('deportes', 'Deportes'), ('carreras', 'Carreras'), ('puzzle', 'Puzle'),
  ('plataformas', 'Plataformas'), ('terror', 'Terror'), ('casual', 'Casual'), ('multijugador', 'Multijugador'),
  ('indie', 'Indie'), ('software', 'Software y utilidades')
ON CONFLICT ("slug") DO NOTHING;
