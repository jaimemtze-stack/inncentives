# ADR-0015: Base de conocimiento bilingüe

- **Estado:** aceptada (fase 2)
- **Contexto:** la base de conocimiento (4.9) es para clientes **autenticados**, en español de México e inglés, organizada por módulos de Inncentives y con respuestas internas solo para el personal.
- **Decisión:**
  - Modelo `KbCategory` (anidable, nombre por idioma) → `KbAnswer` (visibilidad `customer`/`internal`, estado `draft`/`published`/`archived`, publicación programada con `publishAt`) → `KbTranslation` por idioma. Cada guardado crea una `KbTranslationVersion` **de solo inserción** (trigger que rechaza `UPDATE`/`DELETE`), así el historial no se puede reescribir.
  - Búsqueda con una columna generada `search_vector` (español + inglés + `simple`, sin acentos) e índice GIN, igual que tickets. Como `array_to_string` no es `IMMUTABLE`, se usa un *wrapper* `mesa_join_words(text[])` declarado `IMMUTABLE` y protegido con `coalesce`.
  - Tres audiencias calculadas en el servidor: **editor** (`kb.edit`: todo), **agente** (publicadas, internas incluidas) y **cliente** (publicadas, `customer`, `publishAt` vencido). Toda lectura (lista, detalle, búsqueda, sugerencias) pasa por el mismo filtro; lo no visible responde 404.
  - El cuerpo es HTML saneado con la misma lista blanca que los artículos de tickets. Al crear un ticket en el portal se sugieren respuestas (búsqueda por título) y el agente puede insertar un enlace o el texto de una respuesta desde el editor.
  - No hay acceso anónimo: el portal ya exige sesión.
- **Consecuencias:** sin motor de búsqueda externo; una respuesta sin traducción en el idioma del usuario se muestra en el otro idioma disponible.
