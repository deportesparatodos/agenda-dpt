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
        console.log('[AlanGuloTV] Variables de entorno:', {
            VERCEL: process.env.VERCEL,
            AWS_LAMBDA_FUNCTION_VERSION: process.env.AWS_LAMBDA_FUNCTION_VERSION,
            AWS_EXECUTION_ENV: process.env.AWS_EXECUTION_ENV
        });
        
        // Configuración base para el navegador
        let browserOptions = {
            headless: true,
            ignoreHTTPSErrors: true,
        };

        // Configurar según el entorno
        const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION || process.env.AWS_EXECUTION_ENV;
        
        if (isServerless) {
            console.log('[AlanGuloTV] Configurando para entorno serverless (Vercel/Lambda)');
            
            // Usar configuración de @sparticuz/chromium
            browserOptions = {
                ...browserOptions,
                args: [
                    ...chromium.args,
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--single-process'
                ],
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath,
                headless: chromium.headless,
            };
        } else {
            console.log('[AlanGuloTV] Configurando para entorno local');
            
            // Configuración para entorno local
            browserOptions = {
                ...browserOptions,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--disable-gpu'
                ],
                defaultViewport: {
                    width: 1280,
                    height: 720,
                },
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 
                    '/usr/bin/google-chrome-stable' || 
                    '/usr/bin/chromium-browser'
            };
        }

        console.log('[AlanGuloTV] Lanzando navegador con opciones:', JSON.stringify(browserOptions, null, 2));
        
        browser = await puppeteer.launch(browserOptions);

        const page = await browser.newPage();
        
        // Configurar el User-Agent y otros headers
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
        
        // Configurar timeout más largo
        page.setDefaultTimeout(60000);
        page.setDefaultNavigationTimeout(60000);

        const agendaUrl = 'https://alangulotv.blog/agenda-2/';
        console.log(`[AlanGuloTV] Navegando a ${agendaUrl}...`);
        
        // Navegar a la página con configuración mejorada
        await page.goto(agendaUrl, { 
            waitUntil: 'networkidle0', 
            timeout: 60000 
        });

        console.log('[AlanGuloTV] Página cargada, esperando contenido...');

        // Esperar a que aparezcan los contenedores de partidos
        try {
            await page.waitForSelector('.match-container', { timeout: 30000 });
            console.log('[AlanGuloTV] Contenedores de partidos encontrados.');
        } catch (e) {
            console.log('[AlanGuloTV] No se encontraron contenedores .match-container, intentando alternativa...');
            // Intentar con un selector más genérico
            await page.waitForSelector('.agenda-scroller', { timeout: 30000 });
        }

        // Esperar a que el contenido dinámico se cargue completamente
        await page.waitForFunction(() => {
            const scroller = document.querySelector('.agenda-scroller');
            return scroller && scroller.children.length > 0;
        }, { timeout: 30000 });

        console.log('[AlanGuloTV] Contenido dinámico cargado, extrayendo HTML...');

        const html = await page.content();
        console.log(`[AlanGuloTV] HTML extraído (${html.length} caracteres), cerrando navegador...`);
        
        await browser.close();
        browser = null;
        
        console.log('[AlanGuloTV] Navegador cerrado. Procesando HTML con Cheerio...');

        const $ = cheerio.load(html);
        const events = [];
        let currentTitle = null;

        // Procesar todos los elementos en el scroller de agenda
        $('.agenda-scroller > *').each((index, element) => {
            const node = element;

            // Procesar comentarios HTML que contienen información de partidos
            if (node.type === 'comment') {
                const commentText = node.data.trim();
                if (commentText.startsWith('Partido:')) {
                    currentTitle = commentText.replace('Partido:', '').trim();
                    console.log(`[AlanGuloTV] Encontrado título en comentario: ${currentTitle}`);
                }
                return;
            }

            // Procesar contenedores de partidos
            if (node.type === 'tag' && $(node).hasClass('match-container')) {
                const $container = $(node);
                
                let title = currentTitle;
                if (!title) {
                    // Fallback: extraer título de los nombres de equipos
                    const teamNames = $container.find('.team-name').map((i, el) => $(el).text().trim()).get();
                    if (teamNames.length >= 2) {
                        title = `${teamNames[0]} vs ${teamNames[1]}`;
                    } else {
                        // Intentar obtener título de otros elementos
                        const eventTitle = $container.find('.event-title, .match-title, h3, h4').first().text().trim();
                        title = eventTitle || 'Evento sin título';
                    }
                }
                
                const time = $container.find('.time, .match-time, .event-time').text().trim() || '-';
                const image = $container.find('.team-logo, .event-logo, img').first().attr('src') || DEFAULT_IMAGE;
                const status = time.toLowerCase().includes('en vivo') ? 'En vivo' : 'Próximamente';

                const options = [];
                const buttons = [];

                // Buscar enlaces en el contenedor actual o en el siguiente
                let linksContainer = $container.find('.links-container');
                if (linksContainer.length === 0) {
                    linksContainer = $container.next('.links-container');
                }

                if (linksContainer.length > 0) {
                    linksContainer.find('a.link-button, a[href]').each((i, linkEl) => {
                        const $link = $(linkEl);
                        const href = $link.attr('href');
                        const buttonName = $link.text().trim() || `Canal ${i + 1}`;
                        
                        if (href && href !== '#') {
                            const fullUrl = href.startsWith('http') ? href : `https://alangulotv.space${href}`;
                            options.push(fullUrl);
                            buttons.push(buttonName);
                        }
                    });
                } else {
                    // Buscar enlaces directamente en el contenedor
                    $container.find('a[href]').each((i, linkEl) => {
                        const $link = $(linkEl);
                        const href = $link.attr('href');
                        const buttonName = $link.text().trim() || `Canal ${i + 1}`;
                        
                        if (href && href !== '#' && !href.includes('javascript:')) {
                            const fullUrl = href.startsWith('http') ? href : `https://alangulotv.space${href}`;
                            options.push(fullUrl);
                            buttons.push(buttonName);
                        }
                    });
                }
                
                if (title && title !== 'Evento sin título') {
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
                    
                    console.log(`[AlanGuloTV] Evento procesado: ${title} - ${options.length} enlaces`);
                }
                
                currentTitle = null;
            }
        });

        console.log(`[AlanGuloTV] ${events.length} eventos procesados exitosamente.`);
        
        if (events.length === 0) {
            console.warn("[AlanGuloTV] No se extrajo ningún evento. Guardando HTML de muestra para debug...");
            console.log("[AlanGuloTV] Muestra de HTML:", html.substring(0, 1000) + "...");
        }
        
        return events;
        
    } catch (error) {
        console.error('Error detallado en fetchAlanGuloTVEvents:', error);
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('Error cerrando navegador:', closeError);
            }
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