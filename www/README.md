# www

La página de instalación, publicada en GitHub Pages por
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml):

    https://webiwabou.github.io/bioinformatica.org/

Es HTML estático sin build: lo que hay aquí es lo que se sirve. El workflow añade una
sola cosa al subirlo — copia el `install` de la raíz del repositorio junto al
`index.html`, de modo que la URL que la página manda pegar en la terminal

    curl -fsSL https://webiwabou.github.io/bioinformatica.org/install | bash

sirve exactamente el mismo script que hay en el repositorio, sin una segunda copia que
se pueda quedar atrás. Por eso el workflow también se dispara cuando cambia `install`.

Para verla en local basta con abrir `index.html` en el navegador; el enlace «leer el
script» apuntará a un fichero que sólo existe una vez desplegado.
