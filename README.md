# WhatsApp Sender Pro

Aplicacion de escritorio en Electron para gestionar envios a contactos y grupos de WhatsApp Web con controles de seguridad, validacion previa, exportacion de integrantes de grupos y evaluacion de riesgo antes de disparar una campaña.

Version actual: 3.5.8

## Para que sirve

- Enviar mensajes a contactos seleccionados desde un buscador en tiempo real.
- Enviar mensajes a grupos seleccionados desde una lista filtrable.
- Adjuntar archivos en campanas individuales o grupales.
- Exportar integrantes de grupos a CSV o Excel.
- Registrar cada envio en SQLite de forma persistente.
- Visualizar estadisticas en vivo de mensajeria (hoy, semana, mes, records, top destinos, porcentajes).
- Abrir una pestana Historial para detalle sin saturar el flujo de envio.
- Exportar reporte consolidado de estadisticas en Excel.
- Validar numeros antes de enviar para reducir intentos fallidos.
- Aplicar controles de cumplimiento y pausas de seguridad para bajar el riesgo operativo.
- Evaluar el riesgo de una campana con un semaforo verde, amarillo o rojo.

## Tecnologias utilizadas

- Electron
- Node.js
- whatsapp-web.js
- qrcode
- sqlite3
- xlsx
- HTML, CSS y JavaScript modularizado

## Como ejecutar

1. Instala dependencias:

```bash
npm install
```

2. Inicia la aplicacion:

```bash
npm start
```

3. Escanea el codigo QR de WhatsApp Web cuando se solicite.

## Como usar la aplicacion

### Contactos

1. Abre la pestaña Contactos.
2. Busca contactos por nombre o numero.
3. Seleccionalos desde la lista.
4. Escribe el mensaje o agrega archivos.
5. Revisa el panel de Riesgo de campana.
6. Si quieres una base segura, pulsa Aplicar configuracion segura.
7. Cuando el riesgo este controlado, pulsa Enviar a contactos.

### Grupos

1. Abre la pestaña Grupos.
2. Filtra y selecciona los grupos.
3. Escribe el mensaje o agrega archivos.
4. Revisa el panel de Riesgo de campana.
5. Si quieres una base segura, pulsa Aplicar configuracion segura.
6. Pulsa Enviar a grupos.

### Exportar miembros de grupo

1. Ve a la pestaña Grupos.
2. Elige un grupo en la seccion Exportar integrantes de grupo.
3. Selecciona Exportar Excel o Exportar CSV.
4. Guarda el archivo sugerido como NombreDelGrupo_miembros.

### Panel de estadisticas en vivo

En la parte superior del panel principal tienes Estadisticas en vivo con datos persistentes en SQLite:

- Hoy: total de unidades enviadas en el dia local actual.
- Semana actual: acumulado semanal.
- Mes actual: acumulado mensual.
- Distribucion: porcentaje de envios a contactos vs grupos.
- Top destinos: contacto y grupo con mayor volumen historico.
- Records: dia y semana con mayor actividad.

Top destinos ahora muestra nombre legible del destino (por ejemplo, nombre real del grupo) y no solo el JID tecnico.

El panel se actualiza automaticamente cada 30 segundos y tambien cuando finaliza un envio.

### Pestana Historial (detalle)

La pestana Historial concentra la vista ampliada para evitar saturar Contactos y Grupos:

- Tabla diaria de actividad.
- Tabla semanal.
- Tabla mensual.
- Top destinos con nombre legible.
- Conteo de chats alcanzados (al menos un envio):
	- Total.
	- Contactos.
	- Grupos.

### Exportar reporte de estadisticas

Desde el mismo panel pulsa Exportar reporte Excel para generar un archivo .xlsx con hojas:

- Resumen
- Resumen Diario
- Resumen Semanal
- Resumen Mensual
- Records
- Top Destinos

El reporte usa datos persistentes, por lo que mantiene historico aunque cierres y abras la app.

## Persistencia de mensajeria en SQLite

La aplicacion registra cada interaccion exitosa en una base SQLite local persistente.

Tabla principal: message_logs

- timestamp_iso (ISO 8601)
- destination_type (contacts o groups)
- destination_id (JID de WhatsApp)
- units_total
- content_type

Adicionalmente, las consultas de analitica calculan chats unicos por tipo para el panel Historial.

Regla de conteo aplicada:

- 1 mensaje de texto = 1 unidad.
- Cada adjunto = 1 unidad adicional.
- Ejemplo: 1 texto + 3 archivos = 4 unidades.

## Seguridad operativa

La aplicacion incluye medidas para reducir riesgo de restricciones o cierres de sesion:

- Validacion previa de numeros por longitud y por registro en WhatsApp.
- Delay minimo y maximo configurable.
- Modo cumplimiento/seguridad.
- Pausas largas periodicas de seguridad.
- Semaforo de riesgo de campana.
- Bloqueo preventivo cuando el riesgo llega a rojo.
- Opcion de forzar envio solo bajo confirmacion explicita.

## Que significa la pausa de seguridad

Ademas del delay normal entre mensaje y mensaje, el sistema aplica pausas aleatorias mas largas cada cierta cantidad de envios cuando el modo cumplimiento esta activo. El objetivo es que la sesion no mantenga un patron demasiado agresivo o mecanico.

Esto no garantiza inmunidad frente a restricciones. Solo reduce riesgo operativo si se usa con criterio.

## Perfiles de cuenta y configuracion segura sugerida

Los perfiles estan conectados al panel de riesgo y tambien al comportamiento del envio cuando el modo cumplimiento esta activo.

### Cuenta nueva

- Volumen sugerido por tanda: hasta 18 destinatarios.
- Delay sugerido entre mensajes: 16 a 24 segundos.
- Pausa de seguridad: cada 5 envios.
- Intervalo aleatorio de pausa de seguridad: 60 a 95 segundos.

### Cuenta media

- Volumen sugerido por tanda: hasta 35 destinatarios.
- Delay sugerido entre mensajes: 12 a 22 segundos.
- Pausa de seguridad: cada 8 envios.
- Intervalo aleatorio de pausa de seguridad: 45 a 75 segundos.

### Cuenta madura

- Volumen sugerido por tanda: hasta 60 destinatarios.
- Delay sugerido entre mensajes: 10 a 20 segundos.
- Pausa de seguridad: cada 12 envios.
- Intervalo aleatorio de pausa de seguridad: 30 a 55 segundos.

## Semaforo de riesgo

- Verde: configuracion razonable para el perfil elegido.
- Amarillo: campana utilizable, pero con señales de precaucion.
- Rojo: envio bloqueado preventivamente por riesgo alto.

Cuando el riesgo esta en rojo:

- El boton normal de envio se deshabilita.
- Se muestra el boton Forzar envio bajo mi responsabilidad.
- Si el usuario decide continuar, debe confirmarlo de forma explicita.

## Popup de progreso durante el envio

Mientras se estan enviando mensajes, el popup muestra:

- Porcentaje de avance.
- Destinatario actual.
- Delay activo aplicado realmente.
- Regla de pausa de seguridad del perfil actual.
- Esperas aleatorias entre mensajes.
- Mensaje de espera larga cuando entra la pausa de seguridad.
- Resumen final de enviados correctos y fallidos.

## No necesitas pagar servidor si lo usas localmente

Si ejecutas esta aplicacion en tu computadora con `npm start`, no necesitas pagar un servidor para usarla.

Solo necesitarias servidor si quisieras:

- tenerla encendida 24/7,
- automatizar campanas sin abrir tu PC,
- o convertirla en un servicio remoto.

Para uso local, basta con abrir la aplicacion cuando la necesites, conectar WhatsApp y ejecutar el envio.

## Peligros y malas practicas

El riesgo aumenta si haces cualquiera de estas cosas:

- enviar demasiados mensajes en poco tiempo,
- usar cuentas nuevas con volumen alto,
- desactivar el modo cumplimiento,
- repetir mensajes masivos sin pausas,
- enviar a listas no depuradas o con numeros invalidos,
- forzar envios en rojo repetidamente,
- mandar muchos adjuntos pesados seguidos.

## Deslinde de responsabilidades

Este software incorpora medidas de seguridad y recomendaciones operativas, pero no puede garantizar que WhatsApp no aplique restricciones, bloqueos, cierres de sesion o revisiones sobre una cuenta.

El usuario es el unico responsable de:

- respetar los limites y protocolos de seguridad,
- decidir si activa o desactiva el modo cumplimiento,
- decidir si fuerza un envio bloqueado por riesgo,
- verificar la legalidad y legitimidad de sus listas de contacto,
- y asumir cualquier consecuencia derivada del uso intensivo, indebido o negligente de la herramienta.

Si no se siguen los protocolos de seguridad, el usuario asume completamente la responsabilidad operativa, tecnica y comercial del uso del sistema.

## Recomendaciones finales

- Mantener activo el modo cumplimiento.
- Preferir perfiles realistas para la antiguedad real de la cuenta.
- No forzar envios en rojo salvo casos excepcionales.
- Probar primero con tandas pequenas.
- Usar listas limpias y segmentadas.
- Aumentar volumen gradualmente.