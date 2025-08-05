import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const DEFAULT_IMAGE = 'https://i.ibb.co/dHPWxr8/depete.jpg';

// Headers más realistas para evadir detección de bots
const getRandomUserAgent = () => {
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
};

const getBrowserHeaders = () => ({
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"'
});

// Función para hacer fetch con reintentos y delay aleatorio
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Delay aleatorio entre intentos
            if (attempt > 1) {
                const delay = Math.random() * 2000 + 1000; // 1-3 segundos
                await new Promise(resolve => setTimeout(resolve, delay));
            }

            const response = await fetch(url, {
                ...options,
                headers: {
                    ...getBrowserHeaders(),
                    ...options.headers
                },
                timeout: 30000
            });

            if (response.ok) {
                return response;
            }

            if (response.status === 403 && attempt < maxRetries) {
                console.log(`[${url}] Intento ${attempt} falló con 403, reintentando...`);
                continue;
            }

            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        } catch (error) {
            console.error(`[${url}] Intento ${attempt} falló:`, error.message);
            
            if (attempt === maxRetries) {
                throw error;
            }
        }
    }
}

/**
 * Scrapea los links de cada evento de wearechecking.online
 */
async function fetchWACLinksForEvent(eventUrl) {
    try {
        const response = await fetchWithRetry(eventUrl);
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
        console.error('Error al obtener links de evento WAC:', eventUrl, error.message);
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
        
        const response = await fetchWithRetry(url);
        const html = await response.text();
        const $ = cheerio.load(html);
        const events = [];
        const eventPromises = [];
        
        $('#streams-dynamic-container .stream-wrapper').each((i, el) => {
            const $wrapper = $(el);
            const imageSrc = $wrapper.find('.stream-thumb').attr('src');
            let imageUrl = DEFAULT_IMAGE;
            if (imageSrc) {
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
                     let spanText = $span.text().replace(/ ￨ |\\|/g, '').trim();
                     time = spanText;
                     title = $p.text().replace($span.text(), '').replace(/^\s* ￨ \s*/, '').replace(/^\s*\|\s*/, '').trim();
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
                    image: imageUrl,
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
        console.error('Error al obtener eventos de WeAreChecking Motorsports:', error.message);
        return [];
    }
}

/**
 * Obtiene eventos desde la página de AlanGuloTV con múltiples estrategias anti-bot
 */
async function fetchAlanGuloTVEvents() {
    const urls = [
        'https://alangulotv.blog/agenda-2/',
        'https://alangulotv.space/agenda-2/',
        'https://www.alangulotv.blog/agenda-2/'
    ];

    for (const url of urls) {
        try {
            console.log(`[AlanGuloTV] Intentando con URL: ${url}`);
            
            // Delay inicial aleatorio
            await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
            
            const response = await fetchWithRetry(url, {
                headers: {
                    'Referer': 'https://www.google.com/',
                    'Origin': 'https://www.google.com'
                }
            });

            const html = await response.text();
            console.log(`[AlanGuloTV] HTML obtenido de ${url} (${html.length} caracteres)`);

            const $ = cheerio.load(html);
            const events = [];
            let currentTitle = null;

            // Estrategia 1: Buscar comentarios HTML y contenedores de partidos
            $('.agenda-scroller > *, .match-container, .event-container, .game-container').each((index, element) => {
                const node = element;

                if (node.type === 'comment') {
                    const commentText = node.data.trim();
                    if (commentText.startsWith('Partido:')) {
                        currentTitle = commentText.replace('Partido:', '').trim();
                        console.log(`[AlanGuloTV] Encontrado título en comentario: ${currentTitle}`);
                    }
                    return;
                }

                if (node.type === 'tag') {
                    const $container = $(node);
                    
                    let title = currentTitle;
                    if (!title) {
                        const teamNames = $container.find('.team-name, .team, .equipo').map((i, el) => $(el).text().trim()).get();
                        if (teamNames.length >= 2) {
                            title = `${teamNames[0]} vs ${teamNames[1]}`;
                        } else {
                            title = $container.find('.event-title, .match-title, .title, h3, h4, h2').first().text().trim();
                        }
                    }
                    
                    if (!title || title === 'Evento') {
                        title = $container.text().trim().split('\n')[0] || null;
                    }
                    
                    if (!title) return;
                    
                    const time = $container.find('.time, .match-time, .event-time, .hora').text().trim() || '-';
                    const image = $container.find('.team-logo, .event-logo, .logo, img').first().attr('src') || DEFAULT_IMAGE;
                    const status = time.toLowerCase().includes('en vivo') ? 'En vivo' : 'Próximamente';

                    const options = [];
                    const buttons = [];

                    // Buscar enlaces en diferentes contenedores
                    let linksContainer = $container.find('.links-container, .enlaces, .canales');
                    if (linksContainer.length === 0) {
                        linksContainer = $container.next('.links-container, .enlaces, .canales');
                    }
                    if (linksContainer.length === 0) {
                        linksContainer = $container;
                    }

                    linksContainer.find('a[href]').each((i, linkEl) => {
                        const $link = $(linkEl);
                        const href = $link.attr('href');
                        let buttonName = $link.text().trim();
                        
                        if (!buttonName) {
                            buttonName = $link.attr('title') || $link.attr('alt') || `Canal ${i + 1}`;
                        }
                        
                        if (href && href !== '#' && !href.includes('javascript:') && !href.includes('mailto:')) {
                            let fullUrl = href;
                            if (!href.startsWith('http')) {
                                if (href.startsWith('/')) {
                                    fullUrl = `https://alangulotv.space${href}`;
                                } else {
                                    fullUrl = `https://alangulotv.space/${href}`;
                                }
                            }
                            options.push(fullUrl);
                            buttons.push(buttonName);
                        }
                    });
                    
                    if (title && title.length > 2 && (options.length > 0 || time !== '-')) {
                        events.push({
                            time,
                            title: title.substring(0, 100), // Limitar longitud
                            options,
                            buttons,
                            category: 'Deportes',
                            language: 'Español',
                            date: new Date().toISOString().split('T')[0],
                            source: 'alangulotv',
                            image: image.startsWith('http') ? image : DEFAULT_IMAGE,
                            status
                        });
                        
                        console.log(`[AlanGuloTV] Evento procesado: ${title} - ${options.length} enlaces`);
                    }
                    
                    currentTitle = null;
                }
            });

            // Estrategia 2: Buscar enlaces directos si no se encontraron eventos
            if (events.length === 0) {
                console.log('[AlanGuloTV] Buscando enlaces directos...');
                
                const foundLinks = new Set();
                $('a[href*="alangulotv"], a[href*="/canal"], a[href*="/ver"], a[href*="stream"]').each((i, linkEl) => {
                    const $link = $(linkEl);
                    const href = $link.attr('href');
                    let text = $link.text().trim();
                    
                    if (!text) {
                        text = $link.closest('div').text().trim().split('\n')[0] || `Canal ${i + 1}`;
                    }
                    
                    if (href && text && !foundLinks.has(href) && text.length > 2) {
                        foundLinks.add(href);
                        let fullUrl = href;
                        if (!href.startsWith('http')) {
                            fullUrl = href.startsWith('/') ? `https://alangulotv.space${href}` : `https://alangulotv.space/${href}`;
                        }
                        
                        events.push({
                            time: '-',
                            title: text.substring(0, 100),
                            options: [fullUrl],
                            buttons: [text.substring(0, 20)],
                            category: 'Deportes',
                            language: 'Español',
                            date: new Date().toISOString().split('T')[0],
                            source: 'alangulotv',
                            image: DEFAULT_IMAGE,
                            status: 'Disponible'
                        });
                    }
                });
                
                console.log(`[AlanGuloTV] Encontrados ${foundLinks.size} enlaces directos`);
            }

            console.log(`[AlanGuloTV] ${events.length} eventos procesados exitosamente desde ${url}`);
            
            if (events.length > 0) {
                return events;
            }

        } catch (error) {
            console.error(`[AlanGuloTV] Error con ${url}:`, error.message);
            continue;
        }
    }

    console.error('[AlanGuloTV] Todos los intentos fallaron');
    return [];
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
        
        const [wacMotorsportsEvents, alanGuloEvents] = await Promise.allSettled([
            fetchWeAreCheckingMotorsportsEvents(),
            fetchAlanGuloTVEvents()
        ]);

        const wearecheckingMotorsportsEvents = wacMotorsportsEvents.status === 'fulfilled' ? wacMotorsportsEvents.value : [];
        const newAlanGuloEvents = alanGuloEvents.status === 'fulfilled' ? alanGuloEvents.value : [];
        
        if (wacMotorsportsEvents.status === 'rejected') {
            console.error('WeAreChecking Motorsports falló:', wacMotorsportsEvents.reason?.message || wacMotorsportsEvents.reason);
        }
        if (alanGuloEvents.status === 'rejected') {
            console.error('AlanGuloTV falló:', alanGuloEvents.reason?.message || alanGuloEvents.reason);
        }

        const allEvents = [...wearecheckingMotorsportsEvents, ...newAlanGuloEvents];
        console.log(`Total eventos obtenidos: WAC=${wearecheckingMotorsportsEvents.length}, AlanGulo=${newAlanGuloEvents.length}, Total=${allEvents.length}`);
        
        if (allEvents.length === 0) {
            console.warn('No se obtuvieron eventos de ninguna fuente');
            return res.status(200).json([]);
        }
        
        // Deduplicación y formateo
        const eventMap = new Map();
        allEvents.forEach(event => {
            if (!event || !event.title) return;

            const key = `${event.title}__${event.time}__${event.source}`;
            if (!eventMap.has(key)) {
                let buttonArr = [];
                let optionsArr = [];
                
                if (event.source === 'wearechecking-motorsports' && Array.isArray(event.options)) {
                    buttonArr = event.options.map(opt => (opt.name || 'CANAL').toUpperCase());
                    optionsArr = event.options.map(opt => opt.link);
                } else if (event.source === 'alangulotv') {
                    buttonArr = event.buttons || [];
                    optionsArr = event.options || [];
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
                    image: event.image || DEFAULT_IMAGE,
                    status: event.status || 'Desconocido'
                });
            }
        });

        const adaptedEvents = Array.from(eventMap.values());
        
        console.log(`Enviando ${adaptedEvents.length} eventos únicos`);
        return res.status(200).json(adaptedEvents);
        
    } catch (error) {
        console.error('Error en la función principal:', error);
        return res.status(500).json({ error: 'Error interno del servidor', details: error.message });
    }
};