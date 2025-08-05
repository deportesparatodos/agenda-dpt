import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import chromium from '@sparticuz/chromium';
// Importamos puppeteer-core en lugar de puppeteer-extra
import puppeteer from 'puppeteer-core';

const DEFAULT_IMAGE = 'https://i.ibb.co/dHPWxr8/depete.jpg';

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
        console.error('Error al obtener eventos de WeAreChecking Motorsports:', error);
        return [];
    }
}

/**
 * Obtiene eventos desde la página de AlanGuloTV usando Puppeteer.
 * @returns {Promise<Array>} Una promesa que resuelve a un array de eventos.
 */
async function fetchAlanGuloTVEvents() {
    let browser = null;
    try {
        console.log('[AlanGuloTV] Iniciando Puppeteer con puppeteer-core...');
        
        browser = await puppeteer.launch({
            // Usamos directamente los argumentos recomendados por @sparticuz/chromium
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        // Añadimos un User-Agent para parecer un navegador normal
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

        const agendaUrl = 'https://alangulotv.blog/agenda-2/';
        console.log(`[AlanGuloTV] Navegando a ${agendaUrl}...`);
        
        await page.goto(agendaUrl, { waitUntil: 'domcontentloaded', timeout: 40000 });

        await page.waitForSelector('.match-container', { timeout: 30000 });
        console.log('[AlanGuloTV] Contenedores de partidos iniciales encontrados.');

        await page.evaluate(() => {
            return new Promise(resolve => {
                const checkContentLoaded = () => {
                    const scroller = document.querySelector('.agenda-scroller');
                    if (scroller && scroller.children.length > 5) {
                        resolve();
                    } else {
                        setTimeout(checkContentLoaded, 500);
                    }
                };
                checkContentLoaded();
            });
        });
        console.log('[AlanGuloTV] Contenido dinámico parece estar cargado.');

        const html = await page.content();
        console.log('[AlanGuloTV] HTML obtenido, cerrando navegador...');
        await browser.close();
        console.log('[AlanGuloTV] Navegador cerrado. Procesando HTML.');

        const $ = cheerio.load(html);
        const events = [];
        let currentTitle = null;

        $('.agenda-scroller > *').each((index, element) => {
            const node = element;

            if (node.type === 'comment') {
                const commentText = node.data.trim();
                if (commentText.startsWith('Partido:')) {
                    currentTitle = commentText.replace('Partido:', '').trim();
                }
                return;
            }

            if (node.type === 'tag' && $(node).hasClass('match-container')) {
                const $container = $(node);
                
                let title = currentTitle;
                if (!title) {
                    const teamNames = $container.find('.team-name').map((i, el) => $(el).text().trim()).get();
                    if (teamNames.length > 1) {
                        title = `${teamNames[0]} vs ${teamNames[1]}`;
                    } else {
                        console.log('[AlanGuloTV] Omitiendo evento sin título claro.');
                        currentTitle = null;
                        return;
                    }
                }
                
                const time = $container.find('.time').text().trim() || '-';
                const image = $container.find('.team-logo').first().attr('src') || $container.find('.event-logo').attr('src') || DEFAULT_IMAGE;
                const status = time.toLowerCase().includes('en vivo') ? 'En vivo' : 'Próximamente';

                const options = [];
                const buttons = [];

                const linksContainer = $container.next('.links-container');
                if (linksContainer.length > 0) {
                    linksContainer.find('a.link-button').each((i, linkEl) => {
                        const $link = $(linkEl);
                        const href = $link.attr('href');
                        const buttonName = $link.text().trim();
                        
                        if (href) {
                            const fullUrl = href.startsWith('http') ? href : `https://alangulotv.space${href}`;
                            options.push(fullUrl);
                            buttons.push(buttonName);
                        }
                    });
                }
                
                if (options.length > 0) {
                    events.push({
                        time,
                        title,
                        options,
                        buttons,
                        category: 'Deportes',
                        language: 'Español',
                        date: new Date().toISOString().split('T')[0],
                        source: 'alangulotv',
                        image,
                        status
                    });
                }
                currentTitle = null;
            }
        });

        console.log(`[AlanGuloTV] ${events.length} eventos procesados exitosamente.`);
        if (events.length === 0) {
            console.warn("[AlanGuloTV] No se extrajo ningún evento. El HTML podría estar vacío o la estructura cambió.");
        }
        return events;
    } catch (error) {
        console.error('Error detallado en fetchAlanGuloTVEvents:', error);
        if (browser) {
            await browser.close();
        }
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
        
        const [wacMotorsportsEvents, alanGuloEvents] = await Promise.allSettled([
            fetchWeAreCheckingMotorsportsEvents(),
            fetchAlanGuloTVEvents()
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
                        const link = opt.link || opt;
                        if (!existing.options.includes(link)) {
                            existing.options.push(link);
                            existing.buttons.push((opt.name || 'CANAL').toUpperCase());
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
