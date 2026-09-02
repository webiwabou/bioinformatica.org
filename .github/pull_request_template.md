### Issue asociada

Closes #

<!-- Todo pull request debe referirse a una issue existente. Si no la hay, ábrela primero. -->

### Tipo de cambio

- [ ] Corrección de un fallo
- [ ] Funcionalidad nueva (acordada antes en una issue)
- [ ] Refactor sin cambio de comportamiento
- [ ] Documentación

### Qué hace y por qué funciona

<!--
Explícalo con tus palabras: cuál era el problema, qué has cambiado y por qué eso lo
arregla. Se espera que entiendas por qué funciona; si no lo entiendes del todo, dilo
abiertamente para que quien revise sepa cuánto peso darle.

Las descripciones largas generadas por IA pueden hacer que este PR se cierre sin revisar.
-->

### Cómo lo has verificado

<!--
Qué has ejecutado y qué has observado. Si quien revisa no puede reproducir tu
comprobación, el PR tarda mucho más en entrar.
-->

### Capturas o grabaciones

<!-- Sólo si el cambio afecta a la TUI: antes y después. -->

### Si el cambio toca la capa de especialización

<!--
Rellena esto sólo si has tocado la persona, las skills, las herramientas de dominio o
los artefactos de proveniencia. Se puede borrar en cualquier otro caso.
-->

- [ ] He comprobado que el brazo sin capa sigue siendo equivalente al agente base:
      `BIOINFORMATICA_ABLATE=all bioinformatica debug ablation --leaks`
- [ ] Si el cambio afecta a lo que se escribe sobre una ejecución (manifiesto, protocolo,
      conteo de intervenciones, dossier), sigue verificándose en frío, sin modelo y sin red.

### Comprobaciones

- [ ] He probado los cambios en local
- [ ] `bun typecheck` pasa
- [ ] `bun turbo test` pasa
- [ ] Este PR no incluye cambios sin relación con la issue

<!--
El título del PR sigue conventional commits: feat:, fix:, docs:, chore:, refactor:, test:,
opcionalmente con el paquete afectado — p. ej. `fix(bioinformatica): …`.
Ver CONTRIBUTING.md.
-->
