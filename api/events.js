import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const DEFAULT_IMAGE = 'https://i.ibb.co/dHPWxr8/depete.jpg';

/**
 * PRIMER PASO: Scrapea y devuelve la lista de canales desde la web (en memoria, no guarda archivo).
 */
async function fetchChannelsObject() {
    const url = 'https://alangulotv.space/canal/';
    console.log(`[SCRAPER] Iniciando actualización de canales desde: ${url}`);
    try {
        const response = await fetch(url, { timeout: 15000 });
        if (!response.ok) {
            throw new Error(`Error al acceder a la página de canales. Estado: ${response.status}`);
        }
        const html = await response.text();
        const regex = /const\s+channels\s*=\s*(\{[\s\S]*?\});/;
        const match = html.match(regex);
        if (match && match[1]) {
            let channelsObjectString = match[1];
            let parsedObject;
            try {
                // eslint-disable-next-line no-eval
                parsedObject = eval('(' + channelsObjectString + ')');
            } catch (e) {
                console.error('[SCRAPER] Error al evaluar el objeto channels:', e);
                return { canales: {} };
            }
            console.log(`[SCRAPER] ¡Éxito! Canales obtenidos en memoria.`);
            return { canales: parsedObject };
        } else {
            console.error("[SCRAPER] No se pudo encontrar el objeto 'const channels' en el HTML.");
            return { canales: {} };
        }
    } catch (error) {
        console.error("[SCRAPER] Falló la actualización de canales.", error.message);
        return { canales: {} };
    }
}

/**
 * Detecta dinámicamente el dominio base de AlanGuloTV siguiendo redirecciones.
 */
async function getDynamicAlanGuloConfig() {
    const mainUrl = 'https://alangulotv.blog'; // Usamos el último dominio conocido como punto de partida
    try {
        console.log(`[AlanGuloTV] Buscando el dominio activo desde: ${mainUrl}`);
        const response = await fetch(mainUrl, {
            redirect: 'follow', // Sigue las redirecciones automáticamente
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        // La URL final después de todas las redirecciones
        const finalUrl = new URL(response.url);
        const baseDomain = finalUrl.hostname;
        const linkDomain = `p.${baseDomain}`;
        const agendaUrl = `https://${baseDomain}/agenda-2/`;
        const baseOrigin = `https://${baseDomain}`;

        console.log(`[AlanGuloTV] Dominio activo detectado: ${baseDomain}`);
        return { baseDomain, linkDomain, agendaUrl, baseOrigin };
    } catch (error) {
        console.error('[AlanGuloTV] No se pudo obtener el dominio dinámico. Usando valores por defecto.', error);
        // Fallback a un dominio conocido si la detección falla
        const baseDomain = 'alangulotv.space';
        const linkDomain = `p.${baseDomain}`;
        const agendaUrl = `https://${baseDomain}/agenda-2/`;
        const baseOrigin = `https://${baseDomain}`;
        return { baseDomain, linkDomain, agendaUrl, baseOrigin };
    }
}


/**
 * Scrapea los links de cada evento de wearechecking.online
 */
async function fetchWACLinksForEvent(eventUrl) {
    try {
        const response = await fetch(eventUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 15000
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const $ = cheerio.load(html);
        const options = [];
        $('.feed-buttons-wrapper .feed-button').each((i, btn) => {
            const onclick = $(btn).attr('onclick') || '';
            const match = onclick.match(/src = '([^']+)'/);
            const link = match ? match[1] : '';
            const name = $(btn).find('p').text().trim() || 'Canal';
            if (link) {
                options.push({ name, link });
            }
        });
        return options;
    } catch (error) {
        console.error('Error al obtener links de evento WAC:', eventUrl, error);
        return [];
    }
}

/**
 * Scrapea eventos en vivo de wearechecking.online/streams-pages/motorsports
 */
async function fetchWeAreCheckingMotorsportsEvents() {
    try {
        const url = 'https://wearechecking.online/streams-pages/motorsports';
        console.log('Fetching WeAreChecking Motorsports eventos desde', url);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 15000
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const $ = cheerio.load(html);
        const events = [];
        const eventPromises = [];
        $('#streams-dynamic-container .stream-wrapper').each((i, el) => {
            const $wrapper = $(el);
            // Extraer la imagen de la card actual
            const imageSrc = $wrapper.find('.stream-thumb').attr('src');
            let imageUrl = DEFAULT_IMAGE; // Usar imagen por defecto como fallback
            if (imageSrc) {
                // Construir la URL absoluta
                imageUrl = `https://wearechecking.online/${imageSrc.replace(/..[\\/]/, '')}`;
            }

            $wrapper.find('.stream-feed[onclick]').each((j, feedEl) => {
                const $feed = $(feedEl);
                const onclick = $feed.attr('onclick');
                const match = onclick ? onclick.match(/location.href='([^']+)'/) : null;
                const link = match ? `https://wearechecking.online${match[1]}` : '';
                const $p = $feed.find('p');
                if ($p.length === 0 || /No events/i.test($p.text())) return;
                let time = '-';
                let title = $p.text().trim();
                const $span = $p.find('.unix-timestamp');
                if ($span.length) {
                     let spanText = $span.text().replace(/ ￨ |\\|/g, '').trim();
                     time = spanText;
                     title = $p.text().replace($span.text(), '').replace(/^\s* ￨ \s*/, '').replace(/^\s*\|\s*/, '').trim();
                }
                const eventObj = {
                    time,
                    title,
                    link,
                    button: 'WAC',
                    category: 'Motor Sports',
                    language: 'Inglés',
                    date: new Date().toISOString().split('T')[0],
                    source: 'wearechecking-motorsports',
                    image: imageUrl, // Usar la imagen de la card
                    options: []
                };
                const p = fetchWACLinksForEvent(link).then(options => {
                    eventObj.options = options;
                    return eventObj;
                });
                eventPromises.push(p);
            });
        });
        const results = await Promise.all(eventPromises);
        return results.filter(ev => ev.options && ev.options.length > 0);
    } catch (error) {
        console.error('Error al obtener eventos de WeAreChecking Motorsports:', error);
        return [];
    }
}

/**
 * Función para hacer scraping de alangulotv usando Cheerio
 */
async function fetchAlanGuloTVEvents(config, channelsData) { // Acepta los datos de los canales
    const { agendaUrl, linkDomain, baseOrigin } = config; // Usar URL dinámica y origen base
    try {
        console.log(`Fetching AlanGuloTV eventos desde ${agendaUrl}...`);
        const response = await fetch(agendaUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 15000
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const html = await response.text();
        const $ = cheerio.load(html);
        const events = [];
        const eventPromises = [];
        $('.match-container').each((index, element) => {
            try {
                const $container = $(element);
                let imageUrl = $container.find('img.event-logo').attr('src') || '';
                if (!imageUrl) {
                    imageUrl = $container.find('img.team-logo').first().attr('src') || '';
                }
                if (imageUrl && imageUrl.startsWith('/')) {
                    imageUrl = `https://${linkDomain}${imageUrl}`;
                }
                const time = $container.find('.time').text().trim() || '-';
                const teamNames = $container.find('.team-name').map((i, el) => $(el).text().trim()).get();
                const title = teamNames.length > 1 ? `${teamNames[0]} vs ${teamNames[1]}` : teamNames[0] || 'Evento sin título';
                if (title.toUpperCase().includes('MLB')) {
                    imageUrl = `https://${linkDomain}/mlb`;
                }
                const $linksContainer = $container.next('.links-container');
                if ($linksContainer.length > 0) {
                    $linksContainer.find('.link-button, a').each((i, linkEl) => {
                        const $link = $(linkEl);
                        const href = $link.attr('href');
                        const buttonName = $link.text().trim() || 'CANAL';
                        if (href) {
                            let eventPageUrl = href.startsWith('http') ? href : `${baseOrigin}${href}`;
                            const pathParts = href.split('/').filter(part => part.length > 0);
                            const linkKey = pathParts[pathParts.length - 1];
                            const p = (async () => {
                                try {
                                    // Usar el objeto de canales ya cargado
                                    const channelsObj = channelsData.canales;
                                    if (channelsObj && channelsObj[linkKey]) {
                                        const channelData = channelsObj[linkKey];
                                        const firstAvailableKey = Object.keys(channelData)[0];
                                        if (firstAvailableKey) {
                                            const finalLink = channelData[firstAvailableKey];
                                            if (finalLink && typeof finalLink === 'string' && finalLink.trim() !== '') {
                                                events.push({
                                                    time,
                                                    title,
                                                    options: [finalLink],
                                                    buttons: [buttonName],
                                                    category: 'Otros',
                                                    language: 'Español',
                                                    date: new Date().toISOString().split('T')[0],
                                                    source: 'alangulotv',
                                                    image: imageUrl
                                                });
                                            }
                                        }
                                    }
                                } catch (e) {
                                    // Ignorar errores
                                }
                            })();
                            eventPromises.push(p);
                        }
                    });
                }
            } catch (error) {
                console.error('Error procesando evento AlanGuloTV:', error);
            }
        });
        await Promise.all(eventPromises);
        console.log(`AlanGuloTV: ${events.length} eventos obtenidos`);
        return events;
    } catch (error) {
        console.error('Error al obtener eventos de AlanGuloTV:', error);
        return [];
    }
}


// --- FUNCIÓN PRINCIPAL EXPORTADA ---
export default async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('Iniciando obtención de eventos...');
        
        const alanGuloConfig = await getDynamicAlanGuloConfig();
        const channelsData = await fetchChannelsObject(); // Cargar los canales una vez

        const [wacMotorsportsEvents, alanGuloEvents] = await Promise.allSettled([
            fetchWeAreCheckingMotorsportsEvents(),
            fetchAlanGuloTVEvents(alanGuloConfig, channelsData) // Pasar los canales
        ]);

        const wearecheckingMotorsportsEvents = wacMotorsportsEvents.status === 'fulfilled' ? wacMotorsportsEvents.value : [];
        const newAlanGuloEvents = alanGuloEvents.status === 'fulfilled' ? alanGuloEvents.value : [];

        if (wacMotorsportsEvents.status === 'rejected') console.error('WeAreChecking Motorsports falló:', wacMotorsportsEvents.reason);
        if (alanGuloEvents.status === 'rejected') console.error('AlanGuloTV falló:', alanGuloEvents.reason);

        const allEvents = [...wearecheckingMotorsportsEvents, ...newAlanGuloEvents];
        
        console.log(`Total eventos combinados: ${allEvents.length}`);
        
        if (allEvents.length === 0) {
            console.warn('No se obtuvieron eventos de ninguna fuente');
            return res.status(200).json([]);
        }
        
        const eventMap = new Map();
        allEvents.forEach(event => {
            if (!event || !event.title) return;

            const key = `${event.title || 'Sin título'}__${event.time || '-'}__${event.source}`;
            if (!eventMap.has(key)) {
                let buttonArr = [];
                let optionsArr = [];
                if (event.source === 'wearechecking-motorsports' && Array.isArray(event.options) && event.options.length > 0) {
                    buttonArr = event.options.map(opt => (opt.name || 'CANAL').toUpperCase());
                    optionsArr = event.options.map(opt => opt.link);
                } else if (event.source === 'alangulotv') {
                    buttonArr = event.buttons;
                    optionsArr = event.options;
                }
                eventMap.set(key, {
                    time: event.time || '-',
                    title: event.title || 'Sin título',
                    options: optionsArr,
                    buttons: buttonArr,
                    category: event.category || 'Otros',
                    language: event.language || 'Desconocido',
                    date: event.date || new Date().toISOString().split('T')[0],
                    source: event.source || 'unknown',
                    image: event.image || '',
                    status: event.status || 'Desconocido'
                });
            } else {
                const existing = eventMap.get(key);
                if ((event.source === 'wearechecking-motorsports' || event.source === 'alangulotv') && Array.isArray(event.options)) {
                    event.options.forEach(opt => {
                        if (!existing.options.includes(opt.link)) {
                            existing.options.push(opt.link);
                            existing.buttons.push(opt.name.toUpperCase());
                        }
                    });
                }
            }
        });

        let adaptedEvents = Array.from(eventMap.values());
        
        adaptedEvents = adaptedEvents.map(event => {
            if (!event.image) {
                event.image = DEFAULT_IMAGE;
            }
            return event;
        });
        
        return res.status(200).json(adaptedEvents);
    } catch (error) {
        console.error('Error en la función principal:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};
