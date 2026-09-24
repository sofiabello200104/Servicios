'use strict';

// Vercel API function for GET /api/config and POST /api/config.
//
// In Vercel (serverless), there is no writable filesystem between invocations.
// Configuration is read from environment variables set in the Vercel dashboard:
//
//   SOFIA_ODATA_URL      — e.g. https://bpm.webapidashboard.integrasoftsas.co/odata/plantillas
//   SOFIA_ODATA_USER     — e.g. 1003804217
//   SOFIA_ODATA_PASS     — e.g. yourpassword  (mark as "Secret" in Vercel)
//   SOFIA_ODATA_TEMPLATE — e.g. ID12086_Tickets_medidor (optional, defaults to that value)
//
// POST (Guardar from the Parametrizacion panel) returns 405 with an
// explanation so the user knows to update env vars in the Vercel dashboard
// instead of trying to save from the UI.

function getConfigFromEnv() {
  return {
    endpointUrl:  process.env.SOFIA_ODATA_URL      || '',
    authUser:     process.env.SOFIA_ODATA_USER     || '',
    templateName: process.env.SOFIA_ODATA_TEMPLATE || 'ID12086_Tickets_medidor',
    updatedAt:    null,
    configured:   !!(process.env.SOFIA_ODATA_URL && process.env.SOFIA_ODATA_URL.trim())
  };
}

module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const cfg = getConfigFromEnv();
    // Never expose the password to the frontend.
    return res.status(200).json(cfg);
  }

  if (req.method === 'POST') {
    // Vercel functions are stateless — there is no persistent disk to write to.
    // Instruct the user to set env vars in the Vercel dashboard.
    return res.status(405).json({
      error:
        'Este deployment está en Vercel (entorno sin escritura en disco). ' +
        'Para cambiar la configuración OData, actualizá las variables de entorno ' +
        'SOFIA_ODATA_URL, SOFIA_ODATA_USER, SOFIA_ODATA_PASS y SOFIA_ODATA_TEMPLATE ' +
        'en el panel de Vercel y hacé un nuevo deploy.',
      vercelReadOnly: true
    });
  }

  res.status(405).json({ error: 'Método no permitido.' });
};
