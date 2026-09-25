"""Diffusion des mises à jour en direct aux clients du flux /api/stream.

Chaque client connecté possède une file bornée : un client trop lent perd des messages
plutôt que de bloquer l'émetteur. L'interface se resynchronise par ses lectures de secours.
"""

import json
import queue
import threading

EVENT_SUBSCRIBERS = set()
EVENT_SUBSCRIBERS_LOCK = threading.Lock()


def publish_event(event_type, payload):
    """Push a live update to every connected /api/stream subscriber."""
    message = f"event: {event_type}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
    with EVENT_SUBSCRIBERS_LOCK:
        subscribers = list(EVENT_SUBSCRIBERS)
    for subscriber_queue in subscribers:
        try:
            subscriber_queue.put_nowait(message)
        except queue.Full:
            pass
