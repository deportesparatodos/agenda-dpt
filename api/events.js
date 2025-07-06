import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

function adjustTimeZone(time, date) {
    if (!time || !date) return time || '00:00';

    try {
        const [hour, minute] = time.split(':').map(Number);
        
        if (isNaN(hour) || isNaN(minute)) return time;

        // Ajustar hora: +2 horas desde el horario de Lima
        let adjustedHour = hour + 2;
        
        // Manejar el cambio de día si es necesario
        if (adjustedHour >= 24) {
            adjustedHour -= 24;
        }

        // Formato de dos dígitos para hora y minutos
        return `${String(adjustedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    } catch (error) {
        console.error('Error al ajustar zona horaria:', error);
        return time;
    }
}

// Devuelve SIEMPRE el estado 'raw' (sin calcular) y deja que el frontend lo calcule
function determineEventStatus(eventTime, eventDate) {
    return null; // No calcular aquí, lo hará el frontend
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

// Mapeo agrupado de canales
const channelsGrouped = {
    'ESPN': ['espn-b', 'espn-c', 'espn-a', 'espn-d', 'espn1'],
    'ESPN 2': ['espn2-a', 'espn2-b', 'espn2-c', 'espn2-d', 'espn2'],
    'ESPN 3': ['espn3-a', 'espn3-b', 'espn3-c', 'espn3-d', 'espn3'],
    'ESPN 4': ['espn4-a', 'espn4-b', 'espn4-c', 'espn4-d', 'espn4'],
    'ESPN 5': ['espn5-a', 'espn5-b', 'espn5-c', 'espn5-d', 'espn5'],
    'ESPN 6': ['espn6-a', 'espn6-b', 'espn6-c', 'espn6-d', 'espn6'],
    'ESPN 7': ['espn7-a', 'espn7-b', 'espn7-c', 'espn7-d', 'espn7'],
    'ESPNDEPORTES': ['espndeportes-a'],
    'ESPN DEPORTES': ['espndeportes-a'],
    'ESPN PREMIUM': ['espn-premium-a', 'espn-premium-b', 'espn-premium-c', 'espn-premium-d', 'espnpremium'],
    'TNT SPORTS': ['tnt-a', 'tnt-b', 'tnt-c', 'tnt-d', 'tntsports'],
    'TYC SPORTS': ['tyc-a', 'tyc-b', 'tyc-c', 'tyc-d'],
    'FOX SPORTS': ['fox-a', 'fox-b', 'fox-c', 'fox-d', 'foxsports'],
    'FOX SPORTS 2': ['fox2-a', 'fox2-b', 'fox2-c', 'fox2-d', 'foxsports2'],
    'FOX SPORTS 3': ['fox3-a', 'fox3-b', 'fox3-c', 'fox3-d', 'foxsports3'],
    'DIRECTV SPORTS': ['dtv-a', 'dtv-b', 'dtv-c'],
    'DIRECTV SPORTS 2': ['dtv2-a', 'dtv2-b', 'dtv2-c'],
    'DIRECTV SPORTS PLUS': ['dtvplus-a', 'dtvplus-b', 'dtvplus-c'],
    'TV PUBLICA': ['tvp-a', 'tvp-b', 'tvp-c', 'tvp-d'],
    'TELEFE': ['telefe-a', 'telefe-b', 'telefe-c', 'telefe-d'],
    'VTV URUGUAY': ['vtv-a', 'vtv-b', 'vtv-c', 'vtv-d'],
    'VTV PLUS URUGUAY': ['vtvplus-a', 'vtvplus-b', 'vtvplus-c', 'vtvplus-d'],
    'WINSPORTS': ['winsports-a', 'winsports-b'],
    'WINSPORTS PLUS': ['winsportsplus-a', 'winsportsplus-b'],
    'LIGA 1 MAX PERU': ['l1max-a', 'l1max-b'],
    'GOL PERU': ['golperu'],
    'LATINA PERU': ['latinape'],
    'AMERICA TV PERU': ['americatvpe'],
    'ATV PERU': ['atv'],
    'CARACOL TV': ['caracoltv'],
    'TIGO SPORTS PARAGUAY': ['tigosportspy-a', 'tigosportspy-b'],
    'FOX SPORTS PREMIUM MX': ['foxsportspremium-a', 'foxsportspremium-b', 'foxsportspremium-c'],
    'FOX SPORTS MEXICO': ['foxmx-a', 'foxmx-b', 'foxmx-c'],
    'FOX SPORTS 2 MEXICO': ['foxmx2-a', 'foxmx2-b', 'foxmx2-c'],
    'FOX SPORTS 3 MEXICO': ['foxmx3-a', 'foxmx3-b', 'foxmx3-c'],
    'ESPN MEXICO': ['espnmx'],
    'ESPN 2 MEXICO': ['espn2mx'],
    'ESPN 3 MEXICO': ['espn3mx'],
    'FORMULA 1': ['f1-a', 'f1-b'],
    'DAZN FORMULA 1': ['daznf1', 'daznmgp'],
    'INDYCAR': ['indycar', 'auftv'],
    'INDYNXT': ['indynxt'],
    'NASCAR CUP': ['cup', 'cup2'],
    'RALLY': ['rally', 'rally2', 'rallytv'],
    'SUPERFORMULA': ['superformula'],
    'DAZN LA LIGA': ['daznlaliga'],
    'DAZN 1 ESPAÑA': ['daznes1'],
    'DAZN 2 ESPAÑA': ['daznes2'],
    'DAZN 3 ESPAÑA': ['daznes3'],
    'DAZN 4 ESPAÑA': ['daznes4'],
    'BUNDESLIGA 1': ['bundesliga1'],
    'BUNDESLIGA 2': ['bundesliga2'],
    'BUNDESLIGA 3': ['bundesliga3'],
    'BUNDESLIGA 4': ['bundesliga4'],
    'BUNDESLIGA 5': ['bundesliga5'],
    'SPORT TV 1 PORTUGAL': ['sporttv1'],
    'SPORT TV 2 PORTUGAL': ['sporttv2'],
    'SPORT TV 3 PORTUGAL': ['sporttv3'],
    'SPORT TV 4 PORTUGAL': ['sporttv4'],
    'SPORT TV 5 PORTUGAL': ['sporttv5'],
    'SPORT TV 6 PORTUGAL': ['sporttv6'],
    'TNT UK 1': ['tntuk'],
    'TNT UK 2': ['tntuk2'],
    'TNT UK 3': ['tntuk3'],
    'TNT UK 4': ['tntuk4'],
    'EUROSPORTS 1': ['eurosports1-a', 'eurosports1-b'],
    'EUROSPORTS 2': ['eurosports2-a', 'eurosports2-b'],
    'MLS 1': ['mls1'],
    'MLS 2': ['mls2'],
    'MLS 3': ['mls3'],
    'MLS 4': ['mls4'],
    'MLS 5': ['mls5'],
    'MLS 6': ['mls6'],
    'MLS 7': ['mls7'],
    'MLS 8': ['mls8'],
    'MLS 9': ['mls9'],
    'MLS 10': ['mls10'],
    'MLS 11': ['mls11'],
    'MLS 12': ['mls12'],
    'MLS 13': ['mls13'],
    'MLS 14': ['mls14'],
    'NBA 1': ['nba1-a', 'nba1-b'],
    'NBA 2': ['nba2-a', 'nba2-b'],
    'NBA 3': ['nba3-a', 'nba3-b'],
    'NBA 4': ['nba4-a', 'nba4-b'],
    'NBA 5': ['nba5-a', 'nba5-b'],
    'NBA 6': ['nba6-a', 'nba6-b'],
    'NBA 7': ['nba7-a', 'nba7-b'],
    'NBA 8': ['nba8-a', 'nba8-b'],
    'NBA 9': ['nba9-a', 'nba9-b'],
    'NBA 10': ['nba10-a', 'nba10-b'],
    'NBA 11': ['nba11-a', 'nba11-b'],
    'NBA 12': ['nba12-a', 'nba12-b'],
    'NBA 13': ['nba13-a', 'nba13-b'],
    'NBA 14': ['nba14-a', 'nba14-b'],
    'MLB 1': ['mlb1-a', 'mlb1-b'],
    'MLB 2': ['mlb2-a', 'mlb2-b'],
    'MLB 3': ['mlb3-a', 'mlb3-b'],
    'MLB 4': ['mlb4-a', 'mlb4-b'],
    'MLB 5': ['mlb5-a', 'mlb5-b'],
    'MLB 6': ['mlb6-a', 'mlb6-b'],
    'MLB 7': ['mlb7-a', 'mlb7-b'],
    'MLB 8': ['mlb8-a', 'mlb8-b'],
    'MLB 9': ['mlb9-a', 'mlb9-b'],
    'MLB 10': ['mlb10-a', 'mlb10-b'],
    'MLB 11': ['mlb11-a', 'mlb11-b'],
    'MLB 12': ['mlb12-a', 'mlb12-b'],
    'MLB 13': ['mlb13-a', 'mlb13-b'],
    'MLB 14': ['mlb14-a', 'mlb14-b'],
    'GRAN HERMANO 24HS': ['24hs'],
    'GRAN HERMANO CAMARA 1': ['camara1'],
    'GRAN HERMANO CAMARA 2': ['camara2'],
    'GRAN HERMANO CAMARA 3': ['camara3'],
    'GRAN HERMANO MULTICAM': ['ghmulticam'],
    'DISNEY': ['disney1-a', 'disney1-b', 'disneyplus-1'],
    'WWE': ['wwe'],
    'USA NETWORK': ['usanetwork-a', 'usanetwork-b'],
    'NETFLIX 1': ['netflix1'],
    'NETFLIX 2': ['netflix2'],
    'EVENTOS': ['eventos1','eventos2','eventos3','eventos4','eventos5','eventos6','eventos7','eventos8','eventos9','eventos10','eventos11','eventos12','eventos13','eventos14','eventos15', 'transmi1', 'transmi2', 'transmi3', 'transmi4', 'transmi5', 'transmi6', 'transmi7', 'transmi8', 'transmi9', 'transmi10', 'transmi11', 'transmi12', 'transmi13', 'transmi14', 'transmi15', 'transmi16', 'transmi17', 'transmi18', 'transmi19', 'transmi20', 'transmi21', 'transmi22', 'transmi23'],
    'TRANSMISIONES ESPECIALES': ['especial', 'especial2'],
    'MULTICAMARA': ['multicam', 'multi-f1', 'multi-2'],
    'tv-1': ['tv1'],
    'tv-2': ['tv2'],
    'tv-3': ['tv3'],
    'tv-4': ['tv4'],
    'tv-5': ['tv5'],
    'VTVPLUS': ['vtvplus-a'],
};

function normalizeChannelName(name) {
    return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizeChannelForFallback(name) {
    // Quita espacios, pasa a minúsculas y elimina caracteres no alfanuméricos
    return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getFirstChannelKey(name) {
    // Normaliza y busca coincidencia exacta
    const clean = normalizeChannelName(name);
    // 1. Coincidencia exacta
    for (const key in channelsGrouped) {
        if (normalizeChannelName(key) === clean) {
            return channelsGrouped[key][0];
        }
    }
    // 2. Coincidencia por inicio de string
    for (const key in channelsGrouped) {
        if (normalizeChannelName(key).startsWith(clean)) {
            return channelsGrouped[key][0];
        }
    }
    // 3. Fallback: devolver el nombre normalizado para usar como canal
    return null;
}

/**
 * Función para hacer scraping de alangulotv.live usando Cheerio
 */
async function fetchAlanGuloTVEvents() {
    try {
        console.log('Fetching AlanGuloTV eventos...');
        
        const response = await fetch('https://alangulotv.live/agenda-2/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            },
            timeout: 15000
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const html = await response.text();
        const $ = cheerio.load(html);
        const events = [];
        
        // Buscar contenedores de partidos
        $('.match-container').each((index, element) => {
            try {
                const $container = $(element);
                // Extraer la imagen principal del evento
                let imageUrl = '';
                // Buscar primero .event-logo, si no existe, buscar .team-logo
                const $eventLogo = $container.find('img.event-logo');
                if ($eventLogo.length > 0) {
                    imageUrl = $eventLogo.attr('src') || '';
                } else {
                    const $teamLogo = $container.find('img.team-logo');
                    if ($teamLogo.length > 0) {
                        imageUrl = $teamLogo.attr('src') || '';
                    }
                }
                // Si la URL es relativa, hacerla absoluta
                if (imageUrl && imageUrl.startsWith('/')) {
                    imageUrl = `https://alangulotv.live${imageUrl}`;
                }
                // Extraer la hora
                const timeText = $container.find('.time').text().trim();
                const time = timeText || '00:00';
                // Extraer nombres de equipos
                const teamNames = [];
                $container.find('.team-name').each((i, teamEl) => {
                    teamNames.push($(teamEl).text().trim());
                });
                const team1 = teamNames[0] || '';
                const team2 = teamNames[1] || '';
                // Crear título principal
                let title = '';
                if (team1 && team2) {
                    title = `${team1} vs ${team2}`;
                } else if (team1) {
                    title = team1;
                } else {
                    title = 'Evento sin título';
                }
                // FORZAR imagen MLB si el título contiene MLB
                if (title.toUpperCase().includes('MLB')) {
                    imageUrl = 'https://p.alangulotv.live/mlb';
                }
                // Buscar el contenedor de enlaces (siguiente elemento hermano)
                const $linksContainer = $container.next('.links-container');
                const links = [];
                if ($linksContainer.length > 0) {
                    $linksContainer.find('.link-button, a').each((i, linkEl) => {
                        const $link = $(linkEl);
                        const href = $link.attr('href');
                        let buttonName = $link.text().trim();
                        if (!buttonName) buttonName = 'CANAL';
                        let finalLink;
                        // Si el href es /canal/xxx/ o https://alangulotv.live/canal/xxx/ extraer xxx y usarlo como key
                        let canalKey = null;
                        const canalMatch = href && href.match(/\/canal\/([a-zA-Z0-9\-]+)\//);
                        if (canalMatch) {
                            canalKey = canalMatch[1].replace(/-/g, '');
                        }
                        let channelKey = null;
                        if (canalKey) {
                            // Buscar en el mapeo por fallback normalizado
                            for (const key in channelsGrouped) {
                                if (normalizeChannelForFallback(key) === canalKey.toLowerCase()) {
                                    channelKey = channelsGrouped[key][0];
                                    break;
                                }
                            }
                            if (!channelKey) channelKey = canalKey;
                        } else {
                            channelKey = normalizeChannelForFallback(buttonName);
                        }
                        // Si el canal es disney1, disney2, etc, agregar '-a' al final
                        if (/^disney\d+$/i.test(channelKey)) {
                            channelKey = channelKey + '-a';
                        }
                        finalLink = `https://play.alangulotv.live/?channel=${channelKey}`;
                        // REEMPLAZOS ESPECIALES
                        if (finalLink === 'https://play.alangulotv.live/?channel=disneyextensinpc') {
                            finalLink = 'https://play.alangulotv.live/?channel=transmi1';
                        } else if (finalLink === 'https://play.alangulotv.live/?channel=foxsportsmx') {
                            finalLink = 'https://play.alangulotv.live/?channel=foxmx-a';
                        } else if (finalLink === 'https://play.alangulotv.live/?channel=directv') {
                            finalLink = 'https://play.alangulotv.live/?channel=dtv-a';
                        }
                        // REEMPLAZO FINAL SEGÚN TU PEDIDO
                        if (finalLink === 'https://play.alangulotv.live/?channel=telemetraoficialdealangulotv') {
                            finalLink = 'https://alangulo-dashboard-f1.vercel.app/';
                            buttonName = 'TELEMETRIA OFICIAL';
                        } else if (finalLink === 'https://play.alangulotv.live/?channel=multif1') {
                            finalLink = 'https://alangulotv.live/canal/multi-f1/';
                            buttonName = 'MULTICAM (ALANGULOTV)';
                        }

                        // Si el link final es uno de los dos especiales, forzar el nombre del botón aunque sea 'OPCION'
                        if (finalLink === 'https://alangulotv.live/canal/multi-f1/') {
                            buttonName = 'MULTICAM (ALANGULOTV)';
                        }
                        if (finalLink === 'https://alangulo-dashboard-f1.vercel.app/') {
                            buttonName = 'TELEMETRIA OFICIAL';
                        }
                        links.push({
                            name: buttonName,
                            url: finalLink
                        });
                    });
                }
                
                // Solo agregar eventos que tengan enlaces
                if (links.length > 0) {
                    links.forEach(linkObj => {
                        events.push({
                            time: time,
                            title: title,
                            link: linkObj.url,
                            button: linkObj.name, // SIEMPRE el texto real del canal
                            category: 'Deportes',
                            language: 'Español',
                            date: new Date().toISOString().split('T')[0],
                            source: 'alangulotv',
                            image: imageUrl // NUEVO: imagen del evento
                        });
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
        
        // Fallback: intentar con regex si Cheerio falla
        try {
            console.log('Intentando método fallback con regex...');
            return await fetchAlanGuloTVFallback();
        } catch (fallbackError) {
            console.error('Método fallback también falló:', fallbackError);
            return [];
        }
    }
}

/**
 * Método fallback usando regex para parsear AlanGuloTV
 */
async function fetchAlanGuloTVFallback() {
    const response = await fetch('https://alangulotv.live/agenda-2/', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    const events = [];
    
    // Regex para encontrar match-container y links-container
    const containerRegex = /<div class="match-container"[^>]*>(.*?)<\/div>\s*<div class="links-container"[^>]*>(.*?)<\/div>/gs;
    let match;
    
    while ((match = containerRegex.exec(html)) !== null) {
        const matchHTML = match[1];
        const linksHTML = match[2];
        
        try {
            // Extraer hora
            const timeMatch = matchHTML.match(/<span class="time"[^>]*>([^<]+)<\/span>/);
            const time = timeMatch ? timeMatch[1].trim() : '00:00';
            
            // Extraer equipos/títulos
            const teamMatches = [...matchHTML.matchAll(/<span class="team-name"[^>]*>([^<]+)<\/span>/g)];
            const team1 = teamMatches[0] ? teamMatches[0][1].trim() : '';
            const team2 = teamMatches[1] ? teamMatches[1][1].trim() : '';
            
            // Crear título
            let title = '';
            if (team1 && team2) {
                title = `${team1} vs ${team2}`;
            } else if (team1) {
                title = team1;
            } else {
                title = 'Evento sin título';
            }
            
            // Extraer enlaces
            const linkMatches = [...linksHTML.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
            
            linkMatches.forEach(linkMatch => {
                const href = linkMatch[1];
                const linkText = linkMatch[2].trim();
                
                if (href && linkText) {
                    const fullUrl = href.startsWith('/') 
                        ? `https://alangulotv.live${href}` 
                        : href;
                    const urlWithStream = `${fullUrl}?stream=${encodeURIComponent(linkText)}`;
                    
                    events.push({
                        time: time,
                        title: title,
                        link: urlWithStream,
                        category: 'Deportes',
                        language: 'Español',
                        date: new Date().toISOString().split('T')[0],
                        source: 'alangulotv'
                    });
                }
            });
        } catch (error) {
            console.error('Error en fallback regex:', error);
        }
    }
    
    return events;
}

export default async (req, res) => {
    // Configurar CORS
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
        
        // Obtener eventos de ambas fuentes en paralelo with timeout
        const [streamTpEvents, alanGuloEvents] = await Promise.allSettled([
            Promise.race([
                fetchStreamTpGlobalEvents(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout StreamTpGlobal')), 15000))
            ]),
            Promise.race([
                fetchAlanGuloTVEvents(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout AlanGuloTV')), 20000))
            ])
        ]);

        // Procesar resultados
        const streamEvents = streamTpEvents.status === 'fulfilled' ? streamTpEvents.value : [];
        const alanEvents = alanGuloEvents.status === 'fulfilled' ? alanGuloEvents.value : [];
        
        if (streamTpEvents.status === 'rejected') {
            console.error('StreamTpGlobal falló:', streamTpEvents.reason);
        }
        if (alanGuloEvents.status === 'rejected') {
            console.error('AlanGuloTV falló:', alanGuloEvents.reason);
        }

        // Combinar todos los eventos
        const allEvents = [...streamEvents, ...alanEvents];
        console.log(`Total eventos combinados: ${allEvents.length}`);
        
        if (allEvents.length === 0) {
            console.warn('No se obtuvieron eventos de ninguna fuente');
            return res.status(200).json([]);
        }
        
        // Procesar eventos: ajustar horarios y agrupar por título y hora
        const eventMap = new Map();
        allEvents.forEach(event => {
            // Forzar imagen MLB si el título contiene MLB (para cualquier fuente)
            if (event.title && event.title.toUpperCase().includes('MLB')) {
                event.image = 'https://p.alangulotv.live/mlb';
            }
            // Solo procesar eventos que tengan tiempo válido
            if (event.time) {
                // Extraer hora y minuto
                const timeParts = event.time.split(':');
                if (timeParts.length >= 2) {
                    const hour = parseInt(timeParts[0]);
                    const minute = parseInt(timeParts[1]);
                    // Sumar 2 horas (solo para eventos de StreamTpGlobal)
                    let newHour = hour;
                    if (event.source === 'streamtpglobal') {
                        newHour = hour + 2;
                        if (newHour >= 24) newHour -= 24;
                        event.time = `${String(newHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                    } else {
                        // Para alangulotv, NO modificar la hora
                        event.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                    }
                }
            }
            // El estado se calcula SIEMPRE usando la hora que se muestra (event.time ya ajustada)
            const key = `${event.title || 'Sin título'}__${event.time || '00:00'}__${event.source}`;
            if (!eventMap.has(key)) {
                let buttonArr = [];
                if (event.source === 'streamtpglobal' && event.link) {
                    // Extraer el valor después del igual en el parámetro stream
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
                    source: event.source || 'unknown',
                    image: event.image || ''
                });
            } else {
                // Si ya existe, agregar más opciones y botones
                const existing = eventMap.get(key);
                if (event.link && !existing.options.includes(event.link)) {
                    existing.options.push(event.link);
                    if (event.button) existing.buttons.push(event.button);
                }
                // Si el evento de alangulotv tiene imagen, usar esa imagen para la card unificada
                if (event.source === 'alangulotv' && event.image) {
                    existing.image = event.image;
                }
                // Si no tiene imagen y este evento sí, agregarla (fallback)
                if (!existing.image && event.image) {
                    existing.image = event.image;
                }
            }
        });

        // Alinear y corregir botones especiales
        let adaptedEvents = Array.from(eventMap.values()).map(event => {
            // Asegurar que buttons y options tengan la misma longitud
            if (!event.buttons) event.buttons = [];
            while (event.buttons.length < event.options.length) {
                event.buttons.push(undefined);
            }
            // Corregir textos especiales y nunca dejar 'OPCION' para los links especiales
            event.options.forEach((opt, idx) => {
                if (opt === 'https://alangulotv.live/canal/multi-f1/') {
                    event.buttons[idx] = 'MULTICAM (ALANGULOTV)';
                }
                if (opt === 'https://alangulo-dashboard-f1.vercel.app/') {
                    event.buttons[idx] = 'TELEMETRIA OFICIAL';
                }
            });
            // Para eventos de streamtpglobal: si no hay nombre, usar el valor del parámetro stream del link
            if (event.source === 'streamtpglobal') {
                event.options.forEach((opt, idx) => {
                    if (!event.buttons[idx] || event.buttons[idx].toUpperCase() === 'CANAL' || event.buttons[idx].toUpperCase() === 'OPCION') {
                        if (typeof opt === 'string') {
                            const match = opt.match(/[?&]stream=([^&#]+)/i);
                            if (match && match[1]) {
                                event.buttons[idx] = match[1];
                            } else {
                                // Si no hay parámetro stream, usar el último segmento del link
                                try {
                                    const urlObj = new URL(opt);
                                    const last = urlObj.pathname.split('/').filter(Boolean).pop();
                                    event.buttons[idx] = last || 'ENLACE';
                                } catch {
                                    event.buttons[idx] = 'ENLACE';
                                }
                            }
                        } else {
                            event.buttons[idx] = 'ENLACE';
                        }
                    }
                });
            }
            // Si algún botón sigue vacío, usar el canal detectado del link si es posible
            event.options.forEach((opt, idx) => {
                if (!event.buttons[idx] || event.buttons[idx].toUpperCase() === 'CANAL' || event.buttons[idx].toUpperCase() === 'OPCION') {
                    if (typeof opt === 'string') {
                        const urlObj = new URL(opt, 'https://dummy.base');
                        const channel = urlObj.searchParams.get('channel');
                        if (channel) {
                            event.buttons[idx] = channel;
                        } else {
                            // Si no hay channel, usar el último segmento del path
                            const last = urlObj.pathname.split('/').filter(Boolean).pop();
                            event.buttons[idx] = last || 'ENLACE';
                        }
                    } else {
                        event.buttons[idx] = 'ENLACE';
                    }
                }
            });
            // Eliminar botones y opciones cuyo link sea undefined o null
            const filtered = event.options
                .map((opt, idx) => ({ opt, btn: event.buttons[idx] }))
                .filter(pair => pair.opt && pair.opt !== 'undefined' && pair.opt !== 'null');
            event.options = filtered.map(pair => pair.opt);
            event.buttons = filtered.map(pair => pair.btn);
            return event;
        });
        // Eliminar eventos sin botones/canales válidos
        adaptedEvents = adaptedEvents.filter(ev => Array.isArray(ev.options) && ev.options.length > 0 && Array.isArray(ev.buttons) && ev.buttons.length > 0);

        // Cambiar todos los enlaces e imágenes de p.alangulotv.live por p.alangulotv.space
        agrupados.forEach(grupo => {
            // Cambiar en las opciones (links de canales)
            if (Array.isArray(grupo.options)) {
                grupo.options = grupo.options.map(opt =>
                    typeof opt === 'string' ? opt.replace(/https:\/\/p\.alangulotv\.live\//g, 'https://p.alangulotv.space/') : opt
                );
            }
            // Cambiar en la imagen si corresponde
            if (typeof grupo.image === 'string' && grupo.image.startsWith('https://p.alangulotv.live/')) {
                grupo.image = grupo.image.replace('https://p.alangulotv.live/', 'https://p.alangulotv.space/');
            }
            // Reemplazo especial para foxdeportes
            if (link === 'https://p.alangulotv.space/?channel=foxdeportes') {
                return 'https://p.alangulotv.space/?channel=foxdeportes-a';
            }
            return link;
        });

        // --- AGRUPACIÓN AVANZADA DE EVENTOS (idéntica al frontend, ahora con tolerancia de 15min) ---
        function quitarPrefijoTitulo(titulo) {
            if (!titulo) return '';
            const partes = titulo.split(': ');
            return partes.length > 1 ? partes.slice(1).join(': ').trim() : titulo.trim();
        }
        function normalizarTexto(txt) {
            return txt.toLowerCase().replace(/[^a-z0-9áéíóúüñ\s]/gi, '').replace(/\s+/g, ' ').trim();
        }
        function similitudPalabras(a, b) {
            if (!a || !b) return 0;
            const setA = new Set(normalizarTexto(a).split(' '));
            const setB = new Set(normalizarTexto(b).split(' '));
            const inter = new Set([...setA].filter(x => setB.has(x)));
            const union = new Set([...setA, ...setB]);
            return union.size === 0 ? 0 : inter.size / union.size;
        }
        function extraerEquipos(titulo) {
            const sinPrefijo = quitarPrefijoTitulo(titulo);
            const vsMatch = sinPrefijo.match(/(.+?)\s+vs\.?\s+(.+)/i);
            if (vsMatch) {
                const norm = s => s.toLowerCase().normalize('NFD').replace(/[\'’`´]/g, "'").replace(/[\u0300-\u036f]/g, '').replace(/\b(fc|old boys|club|deportivo|cd|cf|ac|sc|ca|athletic|united|city|sporting|real|club atlético|atlético|atletico|the|los|las|el|la|de|del|y|and)\b/gi, '').replace(/[^a-z0-9']/g, '').trim();
                return [norm(vsMatch[1]), norm(vsMatch[2])].sort();
            }
            return [sinPrefijo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9']/g, '').trim()];
        }
        function equiposCoinciden(ev1, ev2) {
            const eq1 = extraerEquipos(ev1.title);
            const eq2 = extraerEquipos(ev2.title);
            return eq1.length === eq2.length && eq1.every((e, i) => e === eq2[i]);
        }
        function minutosDiferencia(t1, t2) {
            const [h1, m1] = t1.split(':').map(Number);
            const [h2, m2] = t2.split(':').map(Number);
            return Math.abs((h1 * 60 + m1) - (h2 * 60 + m2));
        }
        const agrupados = [];
        for (const ev of adaptedEvents) {
            let encontrado = false;
            for (const grupo of agrupados) {
                // Unificar si equipos coinciden y la diferencia de horario es <= 15min
                if (equiposCoinciden(grupo, ev) && minutosDiferencia(grupo.time, ev.time) <= 15) {
                    grupo.options.push(...ev.options);
                    grupo.buttons.push(...ev.buttons);
                    if (ev.title.length > grupo.title.length) {
                        grupo.title = ev.title;
                    }
                    // El horario del grupo será el más temprano
                    if (ev.time < grupo.time) {
                        grupo.time = ev.time;
                    }
                    encontrado = true;
                    break;
                }
                // Fallback: similitud ≥ 0.75 y diferencia de horario <= 15min
                if (!encontrado && similitudPalabras(quitarPrefijoTitulo(grupo.title), quitarPrefijoTitulo(ev.title)) >= 0.75 && minutosDiferencia(grupo.time, ev.time) <= 15) {
                    grupo.options.push(...ev.options);
                    grupo.buttons.push(...ev.buttons);
                    if (ev.title.length > grupo.title.length) {
                        grupo.title = ev.title;
                    }
                    if (ev.time < grupo.time) {
                        grupo.time = ev.time;
                    }
                    encontrado = true;
                    break;
                }
            }
            if (!encontrado) {
                agrupados.push({ ...ev, options: [...ev.options], buttons: [...ev.buttons] });
            }
        }
        // Asignar imagen de alangulotv solo después de agrupar
        for (const grupo of agrupados) {
            for (const ev of adaptedEvents) {
                if (minutosDiferencia(grupo.time, ev.time) <= 15 && equiposCoinciden(grupo, ev) && ev.source === 'alangulotv' && ev.image) {
                    grupo.image = ev.image;
                    break;
                }
            }
            // Imagen Liga Pro Ecuador: si el título inicia con 'Primera A' o algún canal es ECDF
            const ligaProImg = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Football_of_Ecuador_-_Liga_Pro_logo_%28mini%29.svg/2048px-Football_of_Ecuador_-_Liga_Pro_logo_%28mini%29.svg.png';
            if (grupo.title && grupo.title.trim().toLowerCase().startsWith('primera a')) {
                grupo.image = ligaProImg;
            } else if (Array.isArray(grupo.buttons) && grupo.buttons.some(btn => btn && btn.trim().toUpperCase() === 'ECDF')) {
                grupo.image = ligaProImg;
            } else if (Array.isArray(grupo.options) && grupo.options.some(opt => typeof opt === 'string' && opt.toLowerCase().includes('ecdf'))) {
                grupo.image = ligaProImg;
            }
        }

        // --- REGLAS DE IMAGEN PERSONALIZADA SEGÚN TU PEDIDO ---
        for (const grupo of agrupados) {
            // 1. Si algún botón es LIGA1MAX
            if (Array.isArray(grupo.buttons) && grupo.buttons.some(btn => btn && btn.trim().toUpperCase() === 'LIGA1MAX')) {
                grupo.image = 'https://a.espncdn.com/combiner/i?img=%2Fi%2Fleaguelogos%2Fsoccer%2F500%2F1813.png';
            }
            // 2. Si el título contiene F1
            else if (grupo.title && grupo.title.toUpperCase().includes('F1')) {
                grupo.image = 'https://p.alangulotv.live/f1';
            }
            // 3. Si el título contiene Copa Argentina
            else if (grupo.title && grupo.title.toLowerCase().includes('copa argentina')) {
                grupo.image = 'https://p.alangulotv.live/copaargentina';
            }
            // 4. Si el título contiene Primera B Metropolitana
            else if (grupo.title && grupo.title.toLowerCase().includes('primera b metropolitana')) {
                grupo.image = 'https://images.fotmob.com/image_resources/logo/leaguelogo/9213.png';
            }
            // 5. Si el título contiene Mundial de Clubes
            else if (grupo.title && grupo.title.toLowerCase().includes('mundial de clubes')) {
                grupo.image = 'https://p.alangulotv.live/copamundialdeclubes';
            }
            // 6. Si el título contiene UFC
            else if (grupo.title && grupo.title.toUpperCase().includes('UFC')) {
                grupo.image = 'https://i.ibb.co/chR144x9/boxing-glove-emoji-clipart-md.png';
            }
            // 7. Si el título contiene Boxeo
            else if (grupo.title && grupo.title.toLowerCase().includes('boxeo')) {
                grupo.image = 'https://p.alangulotv.live/boxeo';
            }
            // 8. Si no tiene imagen, poner imagen por defecto
            if (!grupo.image) {
                grupo.image = 'https://cdn-icons-png.flaticon.com/512/9192/9192710.png';
            }
        }

        return res.status(200).json(agrupados);
    } catch (error) {
        console.error('Error en la función principal:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};