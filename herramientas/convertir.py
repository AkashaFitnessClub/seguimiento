#!/usr/bin/env python3
"""
Convierte la app tal como sale del artifact de Claude (un solo .html que
guarda todo en localStorage) en la versión con base de datos compartida.

Uso:
    python3 herramientas/convertir.py original/akasha-seguimiento-AAAA-MM-DD.html

Genera:
    app/index.html                     la app lista para publicar
    datos-privados/alumnos-base.json   la lista de alumnos que venía escrita
                                       dentro del código (NO se publica: va a la base)

Se puede volver a correr con cada versión nueva del artifact: así se
puede seguir mejorando la app en el chat y pasar los cambios acá.
"""
import json
import pathlib
import re
import subprocess
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
SUPABASE_JS = 'vendor/supabase-2.45.4.js'


def fallar(msg):
    sys.exit('ERROR: ' + msg)


def main():
    if len(sys.argv) != 2:
        fallar('pasá la ruta del .html original')
    html = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')

    # 1) El script principal de la app: el último <script> sin src.
    aperturas = [m for m in re.finditer(r'<script>', html)]
    if not aperturas:
        fallar('no encontré el script de la app')
    ini = aperturas[-1]
    fin = html.find('</script>', ini.end())
    if fin < 0:
        fallar('el script de la app no cierra')
    codigo = html[ini.end():fin]

    # 2) La lista de alumnos escrita en el código pasa a la base de datos.
    m = re.search(r'^const ALUMNOS = \[\n.*?^\];\n', codigo, re.S | re.M)
    if not m:
        fallar('no encontré "const ALUMNOS = [ ... ];"')
    literal = m.group(0)[len('const ALUMNOS = '):].rstrip().rstrip(';')
    r = subprocess.run(['node', '-e', 'process.stdout.write(JSON.stringify(eval(require("fs").readFileSync(0,"utf8"))))'],
                       input='(' + literal + ')', capture_output=True, text=True)
    if r.returncode != 0:
        fallar('no pude leer la lista de alumnos: ' + r.stderr)
    alumnos = json.loads(r.stdout)
    privados = RAIZ / 'datos-privados'
    privados.mkdir(exist_ok=True)
    (privados / 'alumnos-base.json').write_text(json.dumps(alumnos, ensure_ascii=False, indent=0), encoding='utf-8')
    codigo = codigo.replace(m.group(0),
        "/* La lista base de alumnos ahora vive en la base de datos (clave\n"
        "   'akasha-alumnos-base'), no escrita en el código: así el código no\n"
        "   lleva datos personales. */\n"
        "const ALUMNOS = akStore.leerJSON('akasha-alumnos-base', []);\n", 1)

    # 3) Todo lo que se guardaba en el aparato pasa por la capa compartida.
    n_ls = codigo.count('localStorage.')
    codigo = codigo.replace('localStorage.', 'akStore.')

    # 4) "Reiniciar datos de demo" borraría los datos de TODO el equipo.
    boton = '<button class="reset-link" onclick="reiniciarDemo()">↺ Reiniciar datos de demo</button>'
    if boton in codigo:
        codigo = codigo.replace(boton, "${akStore.enLaNube ? '' : '" + boton + "'}")
    codigo, n_guard = re.subn(r'function reiniciarDemo\(\)\{\n',
        "function reiniciarDemo(){\n"
        "  if(akStore.enLaNube){ alert('Con la base compartida esto borraría los datos de todo el equipo, así que está desactivado.'); return; }\n",
        codigo, count=1)
    if not n_guard:
        print('AVISO: no encontré reiniciarDemo(); revisá que no borre datos compartidos.')

    # 5) Textos que ya no son ciertos con la base compartida.
    codigo = codigo.replace('Lo que anota cada profe queda en su aparato.',
                            'Con la base compartida todo se sincroniza solo; esto queda como respaldo extra.')

    # 6) Armar la página: primero la configuración y la capa de datos; el
    #    código de la app queda guardado y lo lanza arranque.js cuando
    #    los datos ya llegaron.
    cargadores = ('<script src="config.js"></script>\n'
                  f'<script src="{SUPABASE_JS}"></script>\n'
                  '<script src="akasha-store.js"></script>\n')
    nuevo = (html[:ini.start()] + cargadores +
             '<script type="text/plain" id="akasha-app-code">' + codigo + '</script>\n'
             '<script src="arranque.js"></script>' + html[fin + len('</script>'):])

    salida = RAIZ / 'app' / 'index.html'
    salida.write_text(nuevo, encoding='utf-8')
    print(f'OK  app/index.html ({len(nuevo)//1024} KB)')
    print(f'    {n_ls} usos de localStorage pasados a la base compartida')
    print(f'    {len(alumnos)} alumnos movidos a datos-privados/alumnos-base.json')


if __name__ == '__main__':
    main()
