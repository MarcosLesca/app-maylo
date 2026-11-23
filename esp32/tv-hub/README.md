# MayLo TV hub (ESP32)

Una dirección fija para el navegador de la tele. El ESP32 queda conectado al Wi-Fi de casa con una IP reservada; la tele guarda **un solo favorito** (`http://<ip-del-esp32>/`) y el ESP32 la manda al teléfono que esté en casa. El video sigue yendo directo del teléfono a la tele: el ESP32 solo anota qué teléfonos hay y redirige.

## Qué hace

- `GET /` — página para la tele (diseño `design/esp32-hub/01-pantalla-de-espera.html`, paleta oscura): "Buscando un teléfono en casa…" con un avatar redondo por teléfono registrado ("Probando…", "En casa" o "No responde"). Pide la lista de teléfonos, prueba primero el más reciente (`<url>/hls.js`, 2 s de espera) y abre el primero que responde ("Conectando con el teléfono de <nombre>…"). Si ninguno responde muestra "Listo para ver algo en la tele" con los pasos (tele → Ver en la tele → Usar el navegador de la tele) y vuelve a intentar cada 5 s con cuenta regresiva. Abajo: "TV MayLo · hub <ip>".
- `POST /register` — el teléfono se anota con `{"url":"http://<ip>:<puerto>/tv/<clave>","name":"<nombre>"}`. Solo se acepta si la IP de la URL es la del propio teléfono que hace el pedido, el puerto está entre 8765 y 8775 y la clave tiene 6 letras/números (cuerpo de hasta 512 bytes). Responde 204, o 400 si algo no cumple. Guarda hasta 4 teléfonos.
- `GET /phones` — `{"phones":[{"url","name","ageSeconds"}]}`, el más reciente primero; solo los vistos en los últimos 180 s.
- Nombre en la red: `maylo-tv` (y `http://maylo-tv.local/` por mDNS, si la red lo permite).

## Paso a paso (Arduino IDE)

1. **Instalar Arduino IDE 2** desde https://www.arduino.cc/en/software.
2. **Agregar las placas ESP32**
   1. Archivo → Preferencias → "URLs adicionales de gestor de placas", pegá:
      `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
   2. Herramientas → Placa → Gestor de placas, buscá **esp32** (de Espressif Systems) e instalá la versión 3.x.
3. **Elegir la placa**: Herramientas → Placa → esp32 → **ESP32 Dev Module**. Conectá el ESP32 por USB y elegí el puerto en Herramientas → Puerto (si no aparece, instalá el driver CP210x o CH340 según tu placa).
4. **Abrir el sketch**: Archivo → Abrir → `esp32/tv-hub/tv-hub.ino`.
5. **Cargar tu Wi-Fi**: en la carpeta `esp32/tv-hub/` copiá `secrets.example.h` como `secrets.h` y poné el nombre y la contraseña de tu Wi-Fi (2,4 GHz; el ESP32 no se conecta a 5 GHz). `secrets.h` no se sube al repositorio.
6. **Subir**: botón "Subir" (flecha →). Si se queda en "Connecting…", mantené apretado el botón **BOOT** del ESP32 hasta que empiece a escribir.
7. **Ver la IP**: Herramientas → Monitor Serie, velocidad **115200**. Presioná **EN/RST** en el ESP32 y vas a ver algo como:

   ```
   MayLo TV hub
   Conectado. Abrí en la tele: http://192.168.0.50/
   ```

8. **Reservar la IP en el router TP-Link Archer AX10** (para que no cambie):
   1. En el navegador entrá a `http://192.168.0.1` (o `http://tplinkwifi.net`) e iniciá sesión.
   2. Andá a **Avanzado → Red → Servidor DHCP**.
   3. En **Reserva de direcciones** tocá **Agregar**, elegí el dispositivo `maylo-tv` (o pegá su dirección MAC) y poné la IP que mostró el Monitor Serie.
   4. Guardá. Reiniciá el ESP32 (botón EN/RST) para que tome la IP reservada.
9. **Guardar el favorito en la tele**: en el navegador de la tele entrá a `http://<ip-del-esp32>/` (por ejemplo `http://192.168.0.50/`) y guardalo en favoritos. Desde ahora siempre usás ese favorito.

## Uso

En el teléfono abrí MayLo → Ver en la tele → Usar el navegador de la tele (la app se anota sola en el ESP32 mientras esa pantalla está activa). En la tele abrí el favorito: te lleva al teléfono que esté en casa.

## Problemas comunes

- **No aparece la IP en el Monitor Serie**: revisá la velocidad (115200) y que `secrets.h` tenga bien el nombre y la contraseña. El ESP32 reintenta conectarse cada 15 s y se reinicia solo si pasa 10 minutos sin Wi-Fi.
- **La tele dice "Abrí la app MayLo en un teléfono…"**: ningún teléfono se anotó en los últimos 3 minutos o no responde; abrí la pantalla "Usar el navegador de la tele" en el teléfono.
- **`maylo-tv.local` no abre**: muchas teles no resuelven mDNS; usá la IP reservada.

## Prueba de la validación (opcional, en una PC)

```sh
g++ -std=c++11 -Wall -Wextra -o /tmp/validation_test esp32/tv-hub/test/validation_test.cpp && /tmp/validation_test
```
