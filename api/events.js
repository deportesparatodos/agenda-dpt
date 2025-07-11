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
 * ACTUALIZADA JULIO 2025: scrapea https://alangulotv.me/agenda-2/ y para cada botón entra a su link,
 * extrae el objeto channels y busca la key correspondiente para obtener el link real.
 */
async function fetchAlanGuloTVEvents(config) {
    // Usar la nueva URL fija
    const agendaUrl = 'https://alangulotv.me/agenda-2/';
    const linkDomain = 'p.alangulotv.space';
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
                        // Usar el nombre del botón de la agenda principal, no el de la subpágina
                        const buttonName = $link.text().trim() || 'CANAL';
                        if (href) {
                            // Construir URL absoluta si es relativa
                            let eventPageUrl = href.startsWith('http') ? href : `https://alangulotv.me${href}`;
                            // Extraer la key de canal de la URL
                            const pathParts = href.split('/').filter(part => part.length > 0);
                            const linkKey = pathParts[pathParts.length - 1];
                            // Promesa: entrar a la página del botón, extraer channels y buscar la key
                            const p = (async () => {
                                try {
                                    const subRes = await fetch(eventPageUrl, {
                                        headers: {
                                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                        },
                                        timeout: 15000
                                    });
                                    if (!subRes.ok) return;
                                    const subHtml = await subRes.text();
                                    // Buscar el objeto channels en el <script>
                                    const channelsMatch = subHtml.match(/const\s+channels\s*=\s*(\{[\s\S]*?\});/);
                                    if (channelsMatch && channelsMatch[1]) {
                                        let channelsObj;
                                        try {
                                            channelsObj = eval('(' + channelsMatch[1] + ')');
                                        } catch (e) {
                                            return;
                                        }
                                        // Buscar la key
                                        if (channelsObj[linkKey]) {
                                            const channelData = channelsObj[linkKey];
                                            const firstAvailableKey = Object.keys(channelData)[0];
                                            if (firstAvailableKey) {
                                                const finalLink = channelData[firstAvailableKey];
                                                if (finalLink && typeof finalLink === 'string' && finalLink.trim() !== '') {
                                                    events.push({
                                                        time,
                                                        title,
                                                        link: finalLink,
                                                        button: buttonName, // nombre del botón de la agenda principal
                                                        category: 'Deportes',
                                                        language: 'Español',
                                                        date: new Date().toISOString().split('T')[0],
                                                        source: 'alangulotv',
                                                        image: imageUrl
                                                    });
                                                }
                                            }
                                        }
                                    }
                                } catch (e) {
                                    // Ignorar errores de fetch individuales
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

/**
 * Scrapea eventos en vivo de wearechecking.online/streams-pages/others
 */
async function fetchWeAreCheckingEvents() {
    try {
        const url = 'https://wearechecking.online/streams-pages/others';
        console.log('Fetching WeAreChecking eventos desde', url);
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
        $('#other-streams .stream-wrapper').each((i, el) => {
            const $wrapper = $(el);
            const $feed = $wrapper.find('.stream-feed');
            const onclick = $feed.attr('onclick');
            if (onclick && onclick.includes("location.href='/streams/")) {
                // Extraer link
                const match = onclick.match(/location.href='([^']+)'/);
                const link = match ? `https://wearechecking.online${match[1]}` : '';
                // Extraer título y hora
                const $p = $feed.find('p');
                let time = '00:00';
                let date = new Date().toISOString().split('T')[0];
                let title = $p.text().trim();
                // Si hay unix-timestamp, usar el texto visible del span como hora
                const $span = $p.find('.unix-timestamp');
                if ($span.length) {
                    let spanText = $span.text().replace(/\u200a|\u200b|\u200c|\u200d|\uFEFF/g, '').replace(/\s*\|\s*$/, '').trim();
                    // Si el texto es un número, es un timestamp y hay que formatearlo
                    if (/^\d{10,}$/.test(spanText)) {
                        const unix = parseInt(spanText);
                        if (!isNaN(unix)) {
                            const eventDate = new Date(unix * 1000);
                            // Formato: 1 jul, 01:00 a.m.
                            const day = eventDate.getDate();
                            const month = eventDate.toLocaleString('es-ES', { month: 'short' });
                            let hour = eventDate.getHours();
                            const minute = eventDate.getMinutes();
                            const ampm = hour < 12 ? 'a.m.' : 'p.m.';
                            hour = hour % 12;
                            if (hour === 0) hour = 12;
                            const minuteStr = String(minute).padStart(2, '0');
                            spanText = `${day} ${month}, ${hour}:${minuteStr} ${ampm}`;
                        }
                    }
                    if (spanText) {
                        time = spanText;
                    }
                    // El título es el texto después del span
                    title = $p.text().replace($span.text(), '').replace(/^\s*\|\s*/, '').trim();
                }
                // Imagen FIJA para others
                let image = 'https://cdn-icons-png.flaticon.com/512/9192/9192710.png';
                // Promesa para obtener los links reales
                const eventObj = {
                    time,
                    title,
                    link, // link a la página del evento
                    button: 'WAC',
                    category: 'Otros',
                    language: 'Inglés',
                    date,
                    source: 'wearechecking',
                    image,
                    options: [] // se llenará luego
                };
                const p = fetchWACLinksForEvent(link).then(options => {
                    eventObj.options = options;
                    return eventObj;
                });
                eventPromises.push(p);
            }
        });
        const results = await Promise.all(eventPromises);
        // Solo eventos con al menos una opción válida
        return results.filter(ev => ev.options && ev.options.length > 0);
    } catch (error) {
        console.error('Error al obtener eventos de WeAreChecking:', error);
        return [];
    }
}

/**
 * Scrapea los links de cada evento de wearechecking.online/streams-pages/others
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
        // Recorrer todos los stream-wrapper de motorsports
        $('#streams-dynamic-container .stream-wrapper').each((i, el) => {
            const $wrapper = $(el);
            // Imagen de la categoría
            let image = $wrapper.find('.stream-thumb').attr('src') || '';
            if (image && image.startsWith('..')) {
                image = 'https://wearechecking.online/' + image.replace(/^\.\./, '').replace(/^\//, '');
            } else if (image && image.startsWith('/')) {
                image = 'https://wearechecking.online' + image;
            }
            // Nombre de la categoría
            let category = $wrapper.find('.series-title img').attr('alt') || '';
            if (category) {
                category = category.replace(/^(series-title-)?/i, '').replace(/\.svg$/i, '').replace(/[-_]/g, ' ').trim();
                category = category.charAt(0).toUpperCase() + category.slice(1);
            } else {
                category = 'Motorsports';
            }
            // Recorrer todos los .stream-feed con onclick (eventos reales)
            $wrapper.find('.stream-feed[onclick]').each((j, feedEl) => {
                const $feed = $(feedEl);
                const onclick = $feed.attr('onclick');
                const match = onclick ? onclick.match(/location.href='([^']+)'/) : null;
                const link = match ? `https://wearechecking.online${match[1]}` : '';
                const $p = $feed.find('p');
                // Si no hay <p> o dice "No events", saltar
                if ($p.length === 0 || /No events/i.test($p.text())) return;
                // Extraer hora y fecha desde el span
                let time = '00:00';
                let eventDate = '';
                let title = $p.text().trim();
                const $span = $p.find('.unix-timestamp');
                if ($span.length) {
                    // Ejemplo: "11 jul, 02:40 a.m. ￨ "
                    let spanText = $span.text().replace(/ ￨ |\\|/g, '').trim();
                    // Separar fecha y hora
                    const fechaHoraMatch = spanText.match(/^(\d{1,2} \w{3}), (\d{2}):(\d{2}) ([ap])\.m\./i);
                    if (fechaHoraMatch) {
                        eventDate = fechaHoraMatch[1]; // "11 jul"
                        let hour = parseInt(fechaHoraMatch[2], 10);
                        const minute = fechaHoraMatch[3];
                        const ampm = fechaHoraMatch[4].toLowerCase();
                        if (ampm === 'p' && hour !== 12) hour += 12;
                        if (ampm === 'a' && hour === 12) hour = 0;
                        time = `${String(hour).padStart(2, '0')}:${minute}`;
                    } else {
                        // Si no matchea, usar todo el span como hora
                        time = spanText;
                        // Intentar extraer solo la fecha si es posible
                        const soloFecha = spanText.match(/^(\d{1,2} \w{3})/i);
                        if (soloFecha) eventDate = soloFecha[1];
                    }
                    // Extraer nombre de la card/categoría desde la clase del wrapper
                    let cardName = '';
                    const wrapperClass = $wrapper.attr('class') || '';
                    const cardMatch = wrapperClass.match(/wrapper-([\w\d]+)/i);
                    if (cardMatch) {
                        cardName = cardMatch[1];
                    } else {
                        cardName = category || '';
                    }
                    // Normalizar nombres especiales
                    if (cardName.toLowerCase() === 'fe') {
                        cardName = 'Formula E';
                    }
                    if (cardName.toLowerCase() === 'superv8') {
                        cardName = 'SUPERCARS';
                    }
                    // El título base es el texto después del span
                    let baseTitle = $p.text().replace($span.text(), '').replace(/^\s* ￨ \s*/, '').replace(/^\s*\|\s*/, '').trim();
                    // Eliminar cualquier referencia a fecha en el título
                    let showDate = '';
                    if (cardName === 'Formula E') {
                        showDate = 'Formula E';
                    }
                    let titleParts = [baseTitle, cardName, showDate].filter(Boolean);
                    // Eliminar repeticiones consecutivas
                    let filteredTitleParts = [];
                    for (let i = 0; i < titleParts.length; i++) {
                        if (i === 0 || titleParts[i].toLowerCase() !== titleParts[i - 1].toLowerCase()) {
                            filteredTitleParts.push(titleParts[i]);
                        }
                    }
                    title = filteredTitleParts.join(' - ');
                }
                // Asignar la fecha legible como eventDate y también como date (para que la app lo use como día del evento)
                let date = '';
                // Imagen FIJA para todos los eventos de motorsports
                image = 'https://images.vexels.com/media/users/3/139434/isolated/preview/4bcbe9b4d3e6f6e4c1207c142a98c2d8-carrera-de-coches-de-carreras-de-ferrari.png';
                const eventObj = {
                    time,
                    title,
                    link,
                    button: 'WAC',
                    category,
                    language: 'Inglés',
                    date, // ahora es la fecha legible del evento
                    eventDate: eventDate || '',
                    source: 'wearechecking-motorsports',
                    image,
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
        // Solo eventos con al menos una opción válida
        return results.filter(ev => ev.options && ev.options.length > 0);
    } catch (error) {
        console.error('Error al obtener eventos de WeAreChecking Motorsports:', error);
        return [];
    }
}

/**
 * Scrapea eventos en vivo de wearechecking.online/streams-pages/football
 */
async function fetchWeAreCheckingFootballEvents() {
    try {
        const url = 'https://wearechecking.online/streams-pages/football';
        console.log('Fetching WeAreChecking Football eventos desde', url);
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
            const $feed = $wrapper.find('.stream-feed');
            const onclick = $feed.attr('onclick');
            if (onclick && onclick.includes("location.href='/streams/")) {
                // Extraer link
                const match = onclick.match(/location.href='([^']+)'/);
                const link = match ? `https://wearechecking.online${match[1]}` : '';
                // Extraer título y hora
                const $p = $feed.find('p');
                let time = '00:00';
                let date = new Date().toISOString().split('T')[0];
                let title = $p.text().trim();
                // Si hay unix-timestamp, usar el texto visible del span como hora
                const $span = $p.find('.unix-timestamp');
                if ($span.length) {
                    let spanText = $span.text().replace(/\u200a|\u200b|\u200c|\u200d|\uFEFF/g, '').replace(/\s*\|\s*$/, '').trim();
                    // Si el texto es un número, es un timestamp y hay que formatearlo
                    if (/^\d{10,}$/.test(spanText)) {
                        const unix = parseInt(spanText);
                        if (!isNaN(unix)) {
                            const eventDate = new Date(unix * 1000);
                            // Formato: 1 jul, 01:00 a.m.
                            const day = eventDate.getDate();
                            const month = eventDate.toLocaleString('es-ES', { month: 'short' });
                            let hour = eventDate.getHours();
                            const minute = eventDate.getMinutes();
                            const ampm = hour < 12 ? 'a.m.' : 'p.m.';
                            hour = hour % 12;
                            if (hour === 0) hour = 12;
                            const minuteStr = String(minute).padStart(2, '0');
                            spanText = `${day} ${month}, ${hour}:${minuteStr} ${ampm}`;
                        }
                    }
                    if (spanText) {
                        time = spanText;
                    }
                    // El título es el texto después del span
                    title = $p.text().replace($span.text(), '').replace(/^\s*\|\s*/, '').trim();
                }
                // Imagen FIJA para football
                let image = 'https://static.vecteezy.com/system/resources/previews/012/996/773/non_2x/sport-ball-football-free-png.png';
                // Promesa para obtener los links reales
                const eventObj = {
                    time,
                    title,
                    link, // link a la página del evento
                    button: 'WAC',
                    category: 'Football',
                    language: 'Inglés',
                    date,
                    source: 'wearechecking-football',
                    image,
                    options: [] // se llenará luego
                };
                const p = fetchWACLinksForEvent(link).then(options => {
                    eventObj.options = options;
                    return eventObj;
                });
                eventPromises.push(p);
            }
        });
        const results = await Promise.all(eventPromises);
        // Solo eventos con al menos una opción válida
        return results.filter(ev => ev.options && ev.options.length > 0);
    } catch (error) {
        console.error('Error al obtener eventos de WeAreChecking Football:', error);
        return [];
    }
}

// --- FBStreams Motorsports ---
/**
 * Scrapea eventos de https://fbstreams.pm/stream/motorsports y extrae el link de transmisión de cada evento
 */
async function fetchFBStreamsMotorsportsEvents() {
    try {
        const url = 'https://fbstreams.pm/stream/motorsports';
        console.log('Fetching FBStreams Motorsports eventos desde', url);
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
        // Cada evento está en un .card o similar (ajustar si cambia el selector)
        $('.card, .event-card, .list-group-item').each((i, el) => {
            const $el = $(el);
            // Título del evento
            let title = $el.find('.card-title, .event-title, .list-group-item-heading').text().trim();
            if (!title) title = $el.find('a').first().text().trim();
            // Link al evento
            let link = $el.find('a').attr('href') || '';
            if (link && !link.startsWith('http')) link = 'https://fbstreams.pm' + link;
            // Hora (si existe)
            let time = $el.find('.event-time, .badge, .list-group-item-text').first().text().trim();
            if (!time) time = '00:00';
            // Imagen (si existe)
            let image = $el.find('img').attr('src') || '';
            if (image && image.startsWith('/')) image = 'https://fbstreams.pm' + image;
            // Promesa: entrar al link del evento y extraer el src del iframe
            if (link) {
                const p = (async () => {
                    try {
                        const subRes = await fetch(link, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            },
                            timeout: 15000
                        });
                        if (!subRes.ok) return;
                        const subHtml = await subRes.text();
                        const $sub = cheerio.load(subHtml);
                        // Buscar el iframe de la transmisión
                        let iframeSrc = $sub('div.ratio iframe').attr('src') || '';
                        if (iframeSrc && iframeSrc.startsWith('/')) iframeSrc = 'https://fbstreams.pm' + iframeSrc;
                        if (iframeSrc) {
                            events.push({
                                time,
                                title: title || 'Evento FBStreams',
                                link: iframeSrc,
                                button: 'FBSTREAMS',
                                category: 'Motorsports',
                                language: 'Inglés',
                                date: new Date().toISOString().split('T')[0],
                                source: 'fbstreams-motorsports',
                                image: image || 'https://cdn-icons-png.flaticon.com/512/9192/9192710.png',
                                options: [{ name: 'FBSTREAMS', link: iframeSrc }]
                            });
                        }
                    } catch (e) {
                        // Ignorar errores individuales
                    }
                })();
                eventPromises.push(p);
            }
        });
        await Promise.all(eventPromises);
        console.log(`FBStreams Motorsports: ${events.length} eventos obtenidos`);
        return events;
    } catch (error) {
        console.error('Error al obtener eventos de FBStreams Motorsports:', error);
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
        
        const [streamTpEvents, alanGuloEvents, wacEvents, wacMotorsportsEvents, wacFootballEvents, fbstreamsMotorsportsEvents] = await Promise.allSettled([
            fetchStreamTpGlobalEvents(),
            fetchAlanGuloTVEvents(alanGuloConfig, canales),
            fetchWeAreCheckingEvents(),
            fetchWeAreCheckingMotorsportsEvents(),
            fetchWeAreCheckingFootballEvents(),
            fetchFBStreamsMotorsportsEvents()
        ]);

        const streamEvents = streamTpEvents.status === 'fulfilled' ? streamTpEvents.value : [];
        const alanEvents = alanGuloEvents.status === 'fulfilled' ? alanGuloEvents.value : [];
        const wearecheckingEvents = wacEvents.status === 'fulfilled' ? wacEvents.value : [];
        const wearecheckingMotorsportsEvents = wacMotorsportsEvents.status === 'fulfilled' ? wacMotorsportsEvents.value : [];
        const wearecheckingFootballEvents = wacFootballEvents.status === 'fulfilled' ? wacFootballEvents.value : [];
        const fbstreamsEvents = fbstreamsMotorsportsEvents.status === 'fulfilled' ? fbstreamsMotorsportsEvents.value : [];
        
        if (streamTpEvents.status === 'rejected') console.error('StreamTpGlobal falló:', streamTpEvents.reason);
        if (alanGuloEvents.status === 'rejected') console.error('AlanGuloTV falló:', alanGuloEvents.reason);
        if (wacEvents.status === 'rejected') console.error('WeAreChecking falló:', wacEvents.reason);
        if (wacMotorsportsEvents.status === 'rejected') console.error('WeAreChecking Motorsports falló:', wacMotorsportsEvents.reason);
        if (wacFootballEvents.status === 'rejected') console.error('WeAreChecking Football falló:', wacFootballEvents.reason);
        if (fbstreamsMotorsportsEvents.status === 'rejected') console.error('FBStreams Motorsports falló:', fbstreamsMotorsportsEvents.reason);

        const allEvents = [
            ...streamEvents,
            ...alanEvents,
            ...wearecheckingEvents,
            ...wearecheckingMotorsportsEvents,
            ...wearecheckingFootballEvents,
            ...fbstreamsEvents
        ];
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
                    let hour = parseInt(timeParts[0]);
                    const minute = parseInt(timeParts[1]);
                    let newHour = hour;
                    if (event.source === 'streamtpglobal') {
                        newHour = hour + 2;
                        if (newHour >= 24) newHour -= 24;
                        event.time = `${String(newHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                    } else if (
                        event.source === 'wearechecking' ||
                        event.source === 'wearechecking-football' ||
                        event.source === 'wearechecking-motorsports'
                    ) {
                        newHour = hour + 7;
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
                let optionsArr = [];
                if (event.source === 'streamtpglobal' && event.link) {
                    const match = event.link.match(/[?&]stream=([^&#]+)/i);
                    buttonArr = [match ? match[1].toUpperCase() : 'CANAL'];
                    optionsArr = [event.link];
                } else if ((event.source === 'wearechecking' || event.source === 'wearechecking-football' || event.source === 'wearechecking-motorsports') && Array.isArray(event.options) && event.options.length > 0) {
                    buttonArr = event.options.map(opt => (opt.name || 'CANAL').toUpperCase());
                    optionsArr = event.options.map(opt => opt.link);
                } else if (event.button) {
                    buttonArr = [event.button];
                    optionsArr = [event.link];
                } else {
                    optionsArr = [event.link];
                }
                eventMap.set(key, {
                    time: event.time || '00:00',
                    title: event.title || 'Sin título',
                    options: optionsArr,
                    buttons: buttonArr,
                    category: event.category || 'Sin categoría',
                    language: event.language || 'Desconocido',
                    date: event.date || new Date().toISOString().split('T')[0],
                    eventDay: event.date || new Date().toISOString().split('T')[0],
                    source: event.source || 'unknown',
                    image: event.image || ''
                });
            } else {
                const existing = eventMap.get(key);
                if ((event.source === 'wearechecking' || event.source === 'wearechecking-football' || event.source === 'wearechecking-motorsports') && Array.isArray(event.options)) {
                    event.options.forEach(opt => {
                        if (!existing.options.includes(opt.link)) {
                            existing.options.push(opt.link);
                            existing.buttons.push(opt.name.toUpperCase());
                        }
                    });
                } else if (event.link && !existing.options.includes(event.link)) {
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