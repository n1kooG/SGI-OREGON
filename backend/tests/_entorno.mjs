// Precarga de `npm test`: sin límite de intentos por defecto, porque la suite hace muchos logins fallidos desde 127.0.0.1
// (con Redis los contadores sobrevivirían entre ejecuciones). tests/limite_login.test.js lo activa explícitamente.
process.env.LOGIN_MAX_POR_IP ??= '0';
process.env.LOGIN_MAX_POR_CORREO ??= '0';
