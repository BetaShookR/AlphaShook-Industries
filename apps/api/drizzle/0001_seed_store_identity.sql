-- Custom SQL migration file, put your code below! ---- Valor inicial editable de la identidad pública de la tienda.
INSERT INTO "settings" ("key", "value")
VALUES ('store.identity', '{"name": "AlphaShook", "logoUrl": null}'::jsonb)
ON CONFLICT ("key") DO NOTHING;
