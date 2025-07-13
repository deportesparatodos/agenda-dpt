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
            source: 'streamtpglobal',
            category: 'Otros'
        }));
    } catch (error) {
        console.error('Error al obtener eventos de StreamTpGlobal:', error);
        return [];
    }
}

/**
 * Función para hacer scraping de alangulotv usando Cheerio
 */
async function fetchAlanGuloTVEvents(config) {
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
                            let eventPageUrl = href.startsWith('http') ? href : `https://alangulotv.me${href}`;
                            const pathParts = href.split('/').filter(part => part.length > 0);
                            const linkKey = pathParts[pathParts.length - 1];
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
                                    const channelsMatch = subHtml.match(/const\s+channels\s*=\s*(\{[\s\S]*?\});/);
                                    if (channelsMatch && channelsMatch[1]) {
                                        let channelsObj;
                                        try {
                                            channelsObj = eval('(' + channelsObjectString + ')');
                                        } catch (e) {
                                            return;
                                        }
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
                                                        button: buttonName,
                                                        category: 'Otros',
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
                const match = onclick.match(/location.href='([^']+)'/);
                const link = match ? `https://wearechecking.online${match[1]}` : '';
                const $p = $feed.find('p');
                let time = '-';
                let date = new Date().toISOString().split('T')[0];
                let title = $p.text().trim();
                const $span = $p.find('.unix-timestamp');
                if ($span.length) {
                    let spanText = $span.text().replace(/\u200a|\u200b|\u200c|\u200d|\uFEFF/g, '').replace(/\s*\|\s*$/, '').trim();
                    if (/^\d{10,}$/.test(spanText)) {
                        const unix = parseInt(spanText);
                        if (!isNaN(unix)) {
                            const eventDate = new Date(unix * 1000);
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
                    if (spanText) time = spanText;
                    title = $p.text().replace($span.text(), '').replace(/^\s*\|\s*/, '').trim();
                }
                const eventObj = {
                    time,
                    title,
                    link,
                    button: 'WAC',
                    category: 'Otros',
                    language: 'Inglés',
                    date,
                    source: 'wearechecking',
                    image: 'https://cdn-icons-png.flaticon.com/512/9192/9192710.png',
                    options: []
                };
                const p = fetchWACLinksForEvent(link).then(options => {
                    eventObj.options = options;
                    return eventObj;
                });
                eventPromises.push(p);
            }
        });
        const results = await Promise.all(eventPromises);
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
                const match = onclick.match(/location.href='([^']+)'/);
                const link = match ? `https://wearechecking.online${match[1]}` : '';
                const $p = $feed.find('p');
                let time = '-';
                let date = new Date().toISOString().split('T')[0];
                let title = $p.text().trim();
                const $span = $p.find('.unix-timestamp');
                if ($span.length) {
                    let spanText = $span.text().replace(/\u200a|\u200b|\u200c|\u200d|\uFEFF/g, '').replace(/\s*\|\s*$/, '').trim();
                    if (/^\d{10,}$/.test(spanText)) {
                        const unix = parseInt(spanText);
                        if (!isNaN(unix)) {
                            const eventDate = new Date(unix * 1000);
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
                    if (spanText) time = spanText;
                    title = $p.text().replace($span.text(), '').replace(/^\s*\|\s*/, '').trim();
                }
                const eventObj = {
                    time,
                    title,
                    link,
                    button: 'WAC',
                    category: 'Otros',
                    language: 'Inglés',
                    date,
                    source: 'wearechecking-football',
                    image: 'https://static.vecteezy.com/system/resources/previews/012/996/773/non_2x/sport-ball-football-free-png.png',
                    options: []
                };
                const p = fetchWACLinksForEvent(link).then(options => {
                    eventObj.options = options;
                    return eventObj;
                });
                eventPromises.push(p);
            }
        });
        const results = await Promise.all(eventPromises);
        return results.filter(ev => ev.options && ev.options.length > 0);
    } catch (error) {
        console.error('Error al obtener eventos de WeAreChecking Football:', error);
        return [];
    }
}

/**
 * Obtiene el mapa de categorías de deportes desde streamed.su
 */
async function fetchStreamedSuSports() {
    try {
        console.log('Fetching Streamed.su sports categories...');
        const response = await fetch('https://streamed.su/api/sports');
        if (!response.ok) {
            throw new Error(`Streamed.su API error for sports: ${response.status}`);
        }
        const sports = await response.json();
        const sportsMap = new Map();
        sports.forEach(sport => sportsMap.set(sport.id, sport.name));
        console.log('Streamed.su sports categories loaded.');
        return sportsMap;
    } catch (error) {
        console.error('Error fetching Streamed.su sports categories:', error.message);
        return new Map(); // Devuelve un mapa vacío en caso de error
    }
}


/**
 * Obtiene eventos en vivo desde la API de streamed.su
 */
async function fetchStreamedSuEvents(sportsMap) {
    try {
        // 1. Obtener IDs de los partidos EN VIVO
        console.log('Fetching Streamed.su live match IDs...');
        const liveMatchesResponse = await fetch('https://streamed.su/api/matches/live', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            timeout: 15000
        });
        if (!liveMatchesResponse.ok) throw new Error('Failed to fetch live matches');
        const liveMatches = await liveMatchesResponse.json();
        const liveMatchIds = new Set(liveMatches.map(m => m.id));
        console.log(`${liveMatchIds.size} live match IDs loaded.`);

        // 2. Obtener TODOS los partidos
        console.log('Fetching ALL Streamed.su matches...');
        const allMatchesResponse = await fetch('https://streamed.su/api/matches/all', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            timeout: 20000
        });
        if (!allMatchesResponse.ok) throw new Error('Failed to fetch all matches');
        const allMatches = await allMatchesResponse.json();
        console.log(`Streamed.su: ${allMatches.length} total matches found.`);

        // 3. Procesar todos los partidos para crear los eventos
        const eventPromises = allMatches.map(async (match) => {
            try {
                if (!match.sources || match.sources.length === 0) return null;

                const streamSourcesPromises = match.sources.map(source =>
                    fetch(`https://streamed.su/api/stream/${source.source}/${source.id}`, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
                        timeout: 10000
                    })
                    .then(res => res.ok ? res.json() : [])
                    .catch(() => [])
                );

                const streamSourcesArrays = await Promise.all(streamSourcesPromises);
                const allStreams = streamSourcesArrays.flat().filter(s => s && s.embedUrl);

                if (allStreams.length === 0) return null;

                const eventDate = new Date(match.date);
                
                const isLive = liveMatchIds.has(match.id);
                const status = isLive ? 'En vivo' : 'Desconocido';
                const time = isLive ? 'En vivo' : eventDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });

                // Lógica de imágenes con la prioridad correcta
                let imageUrl = '';
                if (match.teams?.home?.badge && match.teams?.away?.badge) {
                    imageUrl = `https://streamed.su/api/images/poster/${match.teams.home.badge}/${match.teams.away.badge}.webp`;
                } else if (match.poster) {
                    imageUrl = `https://streamed.su/api/images/proxy/${match.poster}.webp`;
                }

                const buttons = allStreams.map(stream => {
                    let name = (stream.language || `Stream ${stream.streamNo}`).toUpperCase().trim();
                    if (stream.hd) {
                        name += ' HD';
                    }
                    return name;
                });

                return {
                    time: time,
                    title: match.title,
                    options: allStreams.map(stream => stream.embedUrl),
                    buttons: buttons,
                    category: sportsMap.get(match.category) || 'Otros',
                    language: [...new Set(allStreams.map(s => s.language).filter(Boolean))].join(', ') || 'N/A',
                    date: eventDate.toISOString().split('T')[0],
                    source: 'streamedsu',
                    image: imageUrl,
                    status: status,
                };
            } catch (error) {
                console.error(`Error procesando partido de Streamed.su "${match.title}":`, error);
                return null;
            }
        });

        const events = (await Promise.all(eventPromises)).filter(Boolean);
        console.log(`Streamed.su: ${events.length} eventos procesados exitosamente.`);
        return events;

    } catch (error) {
        console.error('Error al obtener eventos de Streamed.su:', error.message);
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
        const canales = await fetchChannelsObject();
        console.log('Iniciando obtención de eventos...');
        const alanGuloConfig = await getDynamicAlanGuloConfig();
        const sportsMap = await fetchStreamedSuSports();
        
        const [streamTpEvents, alanGuloEvents, wacEvents, wacMotorsportsEvents, wacFootballEvents, streamedSuEvents] = await Promise.allSettled([
            fetchStreamTpGlobalEvents(),
            fetchAlanGuloTVEvents(alanGuloConfig, canales),
            fetchWeAreCheckingEvents(),
            fetchWeAreCheckingMotorsportsEvents(),
            fetchWeAreCheckingFootballEvents(),
            fetchStreamedSuEvents(sportsMap)
        ]);

        const streamEvents = streamTpEvents.status === 'fulfilled' ? streamTpEvents.value : [];
        const alanEvents = alanGuloEvents.status === 'fulfilled' ? alanGuloEvents.value : [];
        const wearecheckingEvents = wacEvents.status === 'fulfilled' ? wacEvents.value : [];
        const wearecheckingMotorsportsEvents = wacMotorsportsEvents.status === 'fulfilled' ? wacMotorsportsEvents.value : [];
        const wearecheckingFootballEvents = wacFootballEvents.status === 'fulfilled' ? wacFootballEvents.value : [];
        const newStreamedSuEvents = streamedSuEvents.status === 'fulfilled' ? streamedSuEvents.value : [];
        
        if (streamTpEvents.status === 'rejected') console.error('StreamTpGlobal falló:', streamTpEvents.reason);
        if (alanGuloEvents.status === 'rejected') console.error('AlanGuloTV falló:', alanGuloEvents.reason);
        if (wacEvents.status === 'rejected') console.error('WeAreChecking falló:', wacEvents.reason);
        if (wacMotorsportsEvents.status === 'rejected') console.error('WeAreChecking Motorsports falló:', wacMotorsportsEvents.reason);
        if (wacFootballEvents.status === 'rejected') console.error('WeAreChecking Football falló:', wacFootballEvents.reason);
        if (streamedSuEvents.status === 'rejected') console.error('Streamed.su falló:', streamedSuEvents.reason);

        const allEvents = [...streamEvents, ...alanEvents, ...wearecheckingEvents, ...wearecheckingMotorsportsEvents, ...wearecheckingFootballEvents, ...newStreamedSuEvents];
        console.log(`Total eventos combinados: ${allEvents.length}`);
        
        if (allEvents.length === 0) {
            console.warn('No se obtuvieron eventos de ninguna fuente');
            return res.status(200).json([]);
        }
        
        const eventMap = new Map();
        allEvents.forEach(event => {
            if (!event || !event.title) return;

            if (event.source !== 'streamedsu') {
                event.image = DEFAULT_IMAGE;
            }

            const key = `${event.title || 'Sin título'}__${event.time || '-'}__${event.source}`;
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
                } else if (event.source === 'streamedsu' && Array.isArray(event.options)) {
                    buttonArr = event.buttons;
                    optionsArr = event.options;
                } else if (event.button) {
                    buttonArr = [event.button];
                    optionsArr = [event.link];
                } else {
                    optionsArr = [event.link];
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
