import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

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
    const mainUrl = 'https://alangulotv.live';
    try {
        const response = await fetch(mainUrl, {
            redirect: 'follow',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const finalUrl = new URL(response.url);
        const baseDomain = finalUrl.hostname;
        const linkDomain = `p.${baseDomain}`;
        const agendaUrl = `https://${baseDomain}/agenda-2/`;
        const baseOrigin = `https://${baseDomain}`;

        console.log(`Dominio de AlanGuloTV detectado: ${baseDomain}`);
        return { baseDomain, linkDomain, agendaUrl, baseOrigin };
    } catch (error) {
        console.error('No se pudo obtener el dominio dinámico de AlanGuloTV. Usando valores por defecto.', error);
        const baseDomain = 'alangulotv.space';
        const linkDomain = `p.${baseDomain}`;
        const agendaUrl = `https://${baseDomain}/agenda-2/`;
        const baseOrigin = `https://${baseDomain}`;
        return { baseDomain, linkDomain, agendaUrl, baseOrigin };
    }
}

/**
 * Función para hacer scraping de streamtpglobal.com
 */
async function fetchStreamTpGlobalEvents() {
    try {
        console.log('Fetching StreamTpGlobal eventos JSON...');
        const response = await fetch('https://streamtpglobal.com/eventos.json', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        
        const events = await response.json();
        console.log(`StreamTpGlobal: ${events.length} eventos obtenidos.`);
        
        return events.map(event => ({
            ...event,
            source: 'streamtpglobal'
        }));
    } catch (error) {
        console.error('Error al obtener eventos de StreamTpGlobal:', error);
        return [];
    }
}

/**
 * Función para hacer scraping de alangulotv usando Cheerio
 */
async function fetchAlanGuloTVEvents(config, canales) {
    const { agendaUrl, linkDomain } = config;
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
        $('.match-container').each((index, element) => {
            try {
                const $container = $(element);
                // Prioriza la imagen del evento
                let imageUrl = $container.find('img.event-logo').attr('src') || '';
                if (!imageUrl) {
                    imageUrl = $container.find('img.team-logo').first().attr('src') || '';
                }
                if (imageUrl && imageUrl.startsWith('/')) {
                    imageUrl = `https://${linkDomain}${imageUrl}`;
                }
                const time = $container.find('.time').text().trim() || '00:00';
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
                            const pathParts = href.split('/').filter(part => part.length > 0);
                            const linkKey = pathParts[pathParts.length - 1];
                            if (linkKey && canales.canales && canales.canales[linkKey]) {
                                const channelData = canales.canales[linkKey];
                                const firstAvailableKey = Object.keys(channelData)[0];
                                if (firstAvailableKey) {
                                    const finalLink = channelData[firstAvailableKey];
                                    events.push({
                                        time,
                                        title,
                                        link: finalLink,
                                        button: buttonName,
                                        category: 'Deportes',
                                        language: 'Español',
                                        date: new Date().toISOString().split('T')[0],
                                        source: 'alangulotv',
                                        image: imageUrl
                                    });
                                }
                            }
                        }
                    });
                }
            } catch (error) {
                console.error('Error procesando evento AlanGuloTV:', error);
            }
        });
        
        console.log(`AlanGuloTV: ${events.length} eventos obtenidos`);
        return events;
        
    } catch (error) {
        console.error('Error al obtener eventos de AlanGuloTV:', error);
        return [];
    }
}

/**
 * Función para hacer scraping de eventos en vivo de wearechecking.online
 */
async function fetchWeAreCheckingEvents() {
    try {
        const url = 'https://wearechecking.online/streams-pages/others';
        console.log(`[SCRAPER] Fetching WeAreChecking events from: ${url}`);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const $ = cheerio.load(html);
        const events = [];
        // Busca todos los eventos en vivo en la sección #other-streams
        const eventPromises = [];
        $('#other-streams .stream-wrapper').each((i, el) => {
            const $wrapper = $(el);
            const $feed = $wrapper.find('.stream-feed[onclick]');
            if ($feed.length > 0) {
                // Extrae el link del evento
                const onclick = $feed.attr('onclick');
                const linkMatch = onclick && onclick.match(/location.href='([^']+)'/);
                const link = linkMatch ? `https://wearechecking.online${linkMatch[1]}` : null;
                // Extrae el título y timestamp
                const $p = $feed.find('p');
                let title = $p.text().trim();
                let time = '00:00';
                let date = new Date().toISOString().split('T')[0];
                // Si hay un span.unix-timestamp, úsalo para la fecha y hora
                const $span = $p.find('.unix-timestamp');
                if ($span.length > 0) {
                    const unix = parseInt($span.text());
                    if (!isNaN(unix)) {
                        const eventDate = new Date(unix * 1000);
                        date = eventDate.toISOString().split('T')[0];
                        time = eventDate.toTimeString().slice(0,5);
                    }
                    // Elimina el timestamp del título
                    title = title.replace($span.text(), '').trim();
                }
                // Imagen del evento
                const image = $wrapper.find('.stream-thumb').attr('src')
                    ? `https://wearechecking.online${$wrapper.find('.stream-thumb').attr('src').replace('..','')}`
                    : '';
                // Categoría (por el nombre de la clase wrapper-*)
                const wrapperClass = $wrapper.attr('class') || '';
                const categoryMatch = wrapperClass.match(/wrapper-([\w-]+)/);
                const category = categoryMatch ? categoryMatch[1] : 'Other';
                if (link && title) {
                    // Promesa para extraer los iframes
                    eventPromises.push(
                        fetchWeAreCheckingIframes(link).then(iframes => {
                            if (iframes.length > 0) {
                                events.push({
                                    time,
                                    title,
                                    link: '', // No mostrar el link directo
                                    options: iframes, // iframes como opciones
                                    button: 'VER',
                                    category,
                                    language: 'Inglés',
                                    date,
                                    source: 'wearechecking',
                                    image
                                });
                            }
                        })
                    );
                }
            }
        });
        await Promise.all(eventPromises);
        console.log(`[SCRAPER] WeAreChecking: ${events.length} eventos en vivo encontrados con iframes.`);
        return events;
    } catch (error) {
        console.error('[SCRAPER] Error al obtener eventos de WeAreChecking:', error);
        return [];
    }
}

/**
 * Función para extraer los iframes de cada link de evento de wearechecking
 */
async function fetchWeAreCheckingIframes(eventUrl) {
    try {
        const response = await fetch(eventUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const $ = cheerio.load(html);
        // Extrae todos los src de los iframes
        const iframes = [];
        $('iframe').each((i, el) => {
            const src = $(el).attr('src');
            if (src && src.startsWith('http')) {
                iframes.push(src);
            } else if (src && src.startsWith('/')) {
                iframes.push(`https://wearechecking.online${src}`);
            }
        });
        return iframes;
    } catch (error) {
        console.error(`[SCRAPER] Error al extraer iframes de ${eventUrl}:`, error);
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
        // 1. Obtenemos la lista de canales en memoria
        const canales = await fetchChannelsObject();
        console.log('Iniciando obtención de eventos...');
        const alanGuloConfig = await getDynamicAlanGuloConfig();
        
        const [streamTpEvents, alanGuloEvents, weAreCheckingEvents] = await Promise.allSettled([
            fetchStreamTpGlobalEvents(),
            fetchAlanGuloTVEvents(alanGuloConfig, canales),
            fetchWeAreCheckingEvents()
        ]);

        const streamEvents = streamTpEvents.status === 'fulfilled' ? streamTpEvents.value : [];
        const alanEvents = alanGuloEvents.status === 'fulfilled' ? alanGuloEvents.value : [];
        const wacEvents = weAreCheckingEvents.status === 'fulfilled' ? weAreCheckingEvents.value : [];
        if (streamTpEvents.status === 'rejected') console.error('StreamTpGlobal falló:', streamTpEvents.reason);
        if (alanGuloEvents.status === 'rejected') console.error('AlanGuloTV falló:', alanGuloEvents.reason);
        if (weAreCheckingEvents.status === 'rejected') console.error('WeAreChecking falló:', weAreCheckingEvents.reason);

        const allEvents = [...streamEvents, ...alanEvents, ...wacEvents];
        console.log(`Total eventos combinados: ${allEvents.length}`);
        
        if (allEvents.length === 0) {
            console.warn('No se obtuvieron eventos de ninguna fuente');
            return res.status(200).json([]);
        }
        
        // El resto de la lógica de procesamiento y agrupación de eventos sigue aquí...
        // (Se ha omitido por brevedad, ya que no cambia)
        const eventMap = new Map();
        allEvents.forEach(event => {
            if (event.title && event.title.toUpperCase().includes('MLB')) {
                event.image = `https://${alanGuloConfig.linkDomain}/mlb`;
            }
            if (event.time) {
                const timeParts = event.time.split(':');
                if (timeParts.length >= 2) {
                    const hour = parseInt(timeParts[0]);
                    const minute = parseInt(timeParts[1]);
                    let newHour = hour;
                    if (event.source === 'streamtpglobal') {
                        newHour = hour + 2;
                        if (newHour >= 24) newHour -= 24;
                        event.time = `${String(newHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                    } else {
                        event.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                    }
                }
            }
            const key = `${event.title || 'Sin título'}__${event.time || '00:00'}__${event.source}`;
            if (!eventMap.has(key)) {
                let buttonArr = [];
                if (event.source === 'streamtpglobal' && event.link) {
                    const match = event.link.match(/[?&]stream=([^&#]+)/i);
                    buttonArr = [match ? match[1].toUpperCase() : 'CANAL'];
                } else if (event.button) {
                    buttonArr = [event.button];
                } else {
                    buttonArr = [];
                }
                eventMap.set(key, {
                    time: event.time || '00:00',
                    title: event.title || 'Sin título',
                    options: [event.link],
                    buttons: buttonArr,
                    category: event.category || 'Sin categoría',
                    language: event.language || 'Desconocido',
                    date: event.date || new Date().toISOString().split('T')[0],
                    eventDay: event.date || new Date().toISOString().split('T')[0], // Nuevo campo con la fecha del evento
                    source: event.source || 'unknown',
                    image: event.image || ''
                });
            } else {
                const existing = eventMap.get(key);
                if (event.link && !existing.options.includes(event.link)) {
                    existing.options.push(event.link);
                    if (event.button) existing.buttons.push(event.button);
                }
                if (event.source === 'alangulotv' && event.image) {
                    existing.image = event.image;
                }
                if (!existing.image && event.image) {
                    existing.image = event.image;
                }
            }
        });

        const adaptedEvents = Array.from(eventMap.values());
        // ... (resto del código de agrupación sin cambios)

        return res.status(200).json(adaptedEvents);
    } catch (error) {
        console.error('Error en la función principal:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};