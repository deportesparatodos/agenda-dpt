import fetch from 'node-fetch';

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

export default async (req, res) => {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('Fetching eventos JSON...');
        const response = await fetch('https://streamtpglobal.com/eventos.json');
        if (!response.ok) throw new Error('No se pudo obtener el JSON de eventos');
        const events = await response.json();
        console.log(`Eventos obtenidos: ${events.length} eventos.`);
        
        // Agrupar eventos por título y hora, juntar links en options
        const eventMap = new Map();
        events.forEach(event => {
            // Solo procesar eventos que tengan tiempo válido
            if (event.time) {
                // Extraer hora y minuto
                const [hour, minute] = event.time.split(':').map(Number);
                
                // Sumar 2 horas
                let newHour = hour + 2;
                
                // Ajustar si pasa de medianoche
                if (newHour >= 24) {
                    newHour -= 24;
                }
                
                // Formatear la nueva hora
                event.time = `${String(newHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            }

            const key = `${event.title || 'Sin título'}__${event.time || '00:00'}`;
            if (!eventMap.has(key)) {
                eventMap.set(key, {
                    time: event.time || '00:00',
                    title: event.title || 'Sin título',
                    options: [event.link],
                    category: event.category || 'Sin categoría',
                    language: event.language || 'Desconocido',
                    date: event.date || new Date().toISOString().split('T')[0],
                    status: event.status || 'Próximo'
                });
            } else {
                if (event.link) {
                    eventMap.get(key).options.push(event.link);
                }
            }
        });
        
        // Convertir el Map a array y ordenar por fecha/hora
        // Ordenar eventos: primero los no finalizados, luego los finalizados
        const adaptedEvents = Array.from(eventMap.values())
            .sort((a, b) => {
                // Si uno está finalizado y el otro no, el finalizado va al final
                if (a.status.toLowerCase() === 'finalizado' && b.status.toLowerCase() !== 'finalizado') return 1;
                if (a.status.toLowerCase() !== 'finalizado' && b.status.toLowerCase() === 'finalizado') return -1;
                
                // Si ambos tienen el mismo estado, ordenar por fecha/hora
                const dateA = new Date(`${a.date} ${a.time}`);
                const dateB = new Date(`${b.date} ${b.time}`);
                return dateA - dateB;
            });

        return res.status(200).json(adaptedEvents);
    } catch (error) {
        console.error('Error durante la obtención de eventos:', error);
        return res.status(500).json({
            error: 'Error al obtener los eventos',
            message: error.message
        });
    }
};
