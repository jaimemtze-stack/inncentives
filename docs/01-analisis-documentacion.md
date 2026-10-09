# Inncentives: análisis de la documentación y oportunidades de automatización

Fuentes revisadas:
- Manual de usuario v2.3
- Manual técnico y de operaciones v2.0 (el encabezado interno todavía dice v1.0)
- Manual de seguridad v3.0 (el encabezado interno todavía dice v2.0)

## 1. Qué es Inncentives (modelo mental)

Inncentives es una plataforma ICM con dos aplicaciones:

- **Sistema administrativo**: aquí se hace toda la configuración.
- **Portal**: los beneficiarios consultan sus reportes y levantan aclaraciones.

Stack: .NET (IIS o Kestrel), SQL Server o Azure SQL, Identity Server 4 y Azure (App Service con planes separados para frontend, backend/jobs y **API pública**). Hay ambientes **Dev, QA y Prod**, y el Centro de Comando migra objetos entre ellos.

### Cadena de configuración de un cliente nuevo (todo manual hoy)

| # | Paso | Módulo | Qué se captura a mano |
|---|------|--------|------------------------|
| 1 | Seguridad | Administración › Roles / Usuarios / Alertas | Roles y permisos por módulo; los usuarios se auto-registran y luego se les asigna un rol. |
| 2 | Organización | Organización › Empresa, niveles, jerarquía | Empresa, niveles (área, región, etc.), organigrama y atributos dinámicos. |
| 3 | Población | Beneficiarios / Función de beneficiario | Alta individual o por plantilla Excel: ID, nivel(es), función, jefe, "reporta a", fechas y campos personalizados. |
| 4 | Modelo de datos | Tablas dinámicas | Se crea una tabla física en la BD: nombre (letras y `_`), atributos (Numeric/Text/Bool/Date/Table-FK), PK o llave compuesta, nulo y seleccionable. |
| 5 | Carga de datos | Ver datos › Agregar / Importar, Administrador de archivos, Conexiones FTPS/SFTP/BD | Plantilla Excel, subir el archivo, copiar la ruta y pegarla en el proceso. |
| 6 | Periodos | Calendarios | Nombre, rango y periodicidad (semanal … anual o personalizada). |
| 7 | Plan | Planes de compensación › Configuración › Cálculos (componentes) | Por componente: fuente (Tablas o Componentes), uniones, restricciones, **funciones** (expresiones tipo SQL: `CASE`, `IIF`, `DATEDIFF`, `CAST`, `AVG`, `COUNT`…), calendario, salidas, agrupador y "ejecutar salidas". Se itera con "Previsualizar". |
| 8 | Ejecución | Procesos calendarizados | `PlanExecution`, `ImportStaticTable` e `ImportDynamicTable`; modo manual o automático; disparo con "Trigger"; seguimiento de ejecuciones. |
| 9 | Flujos | Flujos | Actores, restricciones y pasos (autorización y aclaraciones). |
| 10 | Salida | Opciones tipo de reporte, Reportes, Formularios, Categorías de aclaraciones | Secciones del portal, reportes por plan, grupos, vigencias, reglas de acceso y flujo de aclaraciones. |
| 11 | Despliegue | Centro de Comando › Migrar objetos | Selección de origen y destino, validación y resolución de conflictos (Crear, Sobrescribir o Saltarse). |

Las dependencias son estrictas: 2 → 3 → 4 → 5 → 6 → 7 → 8 → 10, y cada sección del plan depende de la anterior.

## 2. Hallazgos clave para la automatización

1. **El motor de cálculo es SQL generado.** Las funciones son expresiones de SQL Server, como lo muestra la nota de `CAST(5 AS FLOAT)/2` para la división entera. Los componentes equivalen a CTEs o vistas encadenadas (uniones, restricciones, funciones y salidas). Esto es justo lo que un LLM traduce bien: una regla de negocio en lenguaje natural o en Excel se convierte en una expresión o componente.
2. **Ya existe un formato serializable de configuración.** "Migrar objetos" exporta tablas, planes, reportes, formularios y calendarios, resuelve dependencias y valida esquemas contra el destino. **Si podemos generar ese paquete de exportación, podemos crear configuraciones completas sin tocar la UI** y reutilizar la validación y la resolución de conflictos que ya existen. Es la palanca más importante; necesitamos un ejemplo del archivo o payload.
3. **Hay una "API Pública"** (App Service propio) y procesos por *jobs*. Hay que confirmar qué endpoints de configuración expone; los manuales no lo documentan.
4. **Las plantillas Excel son el contrato de carga.** Cada tabla tiene "Exportar plantilla", así que se pueden generar y validar los archivos del cliente antes de importarlos.
5. **Ya hay un mecanismo de prueba ("Previsualizar")**, pero es manual y visual. Se puede automatizar como prueba de regresión: resultado del plan contra el cálculo de referencia del cliente (normalmente su Excel actual).
6. **Hay errores conocidos y repetibles** (división entera, nombres con espacios o números, calendarios incompatibles entre fuentes). Son candidatos a un *linter* de configuración.

## 3. Oportunidades priorizadas

| Prioridad | Automatización | Entrada | Salida | Impacto |
|-----------|----------------|---------|--------|---------|
| **A** | **Plan → configuración**: interpretar la política del plan (Word, PDF o Excel del cliente) y generar el diseño completo: tablas, componentes, funciones, restricciones, salidas y calendario. | Documento del plan y diccionario de datos | Especificación intermedia (JSON/YAML) y luego un paquete importable o llamadas a la API | Muy alto: es el trabajo experto más caro. |
| **A** | **Excel del cliente → tablas dinámicas**: inferir tipos, PK o llave compuesta, FKs (`Table`), nulos y nombres válidos. | Archivos de datos de muestra | Definición de tablas y plantillas | Alto |
| **A** | **Conciliación automática**: ejecutar el plan en Dev/QA y comparar contra los resultados esperados, explicando diferencias por componente. | Resultados de Previsualizar o de la ejecución, y el Excel esperado | Reporte de diferencias y sugerencias de corrección | Alto: reduce el ciclo de prueba y error |
| B | Organización y beneficiarios desde el HRIS: mapeo de columnas, niveles, jefes y funciones. | Exportación del HRIS | Plantillas listas para importar | Medio-alto |
| B | Procesos calendarizados, conexiones y calendarios derivados del plan. | Especificación del plan | Procesos y calendarios | Medio |
| B | Reportes, secciones, formularios y flujos de aclaración a partir de las salidas del plan. | Salidas y roles | Reportes y flujos | Medio |
| C | *Linter* y asistente de migración: revisar expresiones (división entera, nulos), dependencias y conflictos antes de migrar a Prod. | Paquete de migración | Hallazgos | Medio |
| C | Copiloto de documentación por cliente: generar el "manual del plan" a partir de la configuración. | Configuración | Documento | Bajo-medio |

### Arquitectura propuesta (sin detalles definitivos todavía)

```
Documentos del cliente ─► [LLM: extracción → especificación intermedia validada por esquema]
                                   │  (revisión humana del consultor)
                                   ▼
                      [Generador determinista]  ──►  paquete de migración / API pública
                                   │                         │
                                   ▼                         ▼
                           Linter de reglas          Inncentives Dev → Previsualizar
                                                             │
                              [LLM: conciliación vs. esperado, propuesta de fix] ◄─┘
                                                             │
                                          Migrar objetos QA → Prod (aprobación humana)
```

Principio de diseño: **el LLM produce una especificación intermedia validada por esquema, nunca escribe directo en Prod.** La traducción de la especificación a objetos de Inncentives es código determinista y probado, y la promoción entre ambientes sigue usando "Migrar objetos" con aprobación humana.

Rutas de integración, de la mejor a la peor:
1. Paquete de exportación de "Migrar objetos".
2. API pública.
3. Inserción en las tablas de metadatos de la BD (frágil y con riesgo de soporte).
4. Automatización de UI con Playwright o *computer use*, solo como último recurso.

## 4. Consideraciones de seguridad (del manual de seguridad)

- Se manejan datos de nómina y datos personales. El manual cita LGPDPPSO y GDPR, y la certificación ISO 27001 está en trámite. Conviene que el LLM trabaje con **metadatos, estructura y muestras anonimizadas**, no con datos reales de empleados.
- La autenticación es Identity Server 4 con usuario y contraseña, **sin MFA ni directorio corporativo** para el acceso a Azure. Un agente automatizado necesita una cuenta de servicio con rol mínimo, limitada a Dev/QA.
- Toda acción automatizada debe quedar en la **Bitácora**, idealmente con una marca de "origen: automatización".
- Si se usa Claude en Azure (Microsoft Foundry), los datos se quedan dentro del ecosistema Azure que Neitek ya opera.

## 5. Inconsistencias detectadas en los manuales

- El manual técnico y el de seguridad tienen versiones distintas en el nombre del archivo y en el encabezado interno (técnico: v2.0 contra v1.0; seguridad: v3.0 contra v2.0).
- El manual de usuario dice que el plan se configura en tres secciones (Fuente de datos, Cálculos y Salida), pero la pantalla actual solo muestra la pestaña **Cálculos**, con la fuente y las salidas dentro de cada componente.
- "Función de beneficiario" aparece bajo Organización, pero la nota al pie la ubica en Tablas y Catálogos.
- El manual anuncia una sección del **Sistema Portal** que no existe en el documento.
- No se documentan la API pública ni el formato del paquete de migración.

## 6. Información que necesitamos para seguir

1. Un **paquete o archivo exportado de "Migrar objetos"** (de un plan de prueba), o la documentación de la API pública (Swagger).
2. Un **plan de compensación real anonimizado**: el documento de la política y su configuración actual en pantallas, para usarlo como caso de referencia.
3. Los archivos de datos típicos de un cliente y el Excel con el cálculo esperado.
4. Dónde se va hoy el tiempo de implementación: horas por paso de la tabla de la sección 1.
5. La lista completa de funciones disponibles en el constructor y los tipos de salida.
6. Las restricciones de infraestructura: ¿la automatización correría dentro de Azure de Neitek? ¿Hay acceso a la BD de Dev?
