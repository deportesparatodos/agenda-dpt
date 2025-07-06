import axios from 'axios';
import cheerio from 'cheerio';

// Endpoint para obtener los eventos scrapeados de alangulotv
export default async (req, res) => {
  try {
    const { data: html } = await axios.get('https://alangulotv.space');
    const $ = cheerio.load(html);
    const eventos = [];

    // Buscar todos los contenedores de partidos
    $('.match-container').each(function (i, elem) {
      const hora = $(elem).find('.time').text().trim();
      const equipos = $(elem).find('.team-container').map((i, el) => ({
        nombre: $(el).find('.team-name').text().trim(),
        logo: $(el).find('.team-logo').attr('src')
      })).get();
      const eventLogo = $(elem).find('.event-logo').attr('src');

      // Buscar los links de canales asociados a este evento
      // Se asume que el siguiente .links-container corresponde a este evento
      const linksContainer = $(elem).nextAll('.links-container').first();
      const canales = linksContainer.find('a.link-button').map((i, el) => ({
        nombre: $(el).text().trim(),
        url: $(el).attr('href')
      })).get();

      eventos.push({
        hora,
        equipos,
        eventLogo,
        canales
      });
    });

    res.status(200).json({ eventos });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los eventos', detalle: error.message });
  }
};
