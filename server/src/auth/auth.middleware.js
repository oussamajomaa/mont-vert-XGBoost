// server/src/auth/auth.middleware.js
import jwt from 'jsonwebtoken';

export function requireAuth(roles = []) {
	return (req, res, next) => {
		try {
			const hdr = req.headers.authorization || '';
			const tokenFromHeader = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
			const tokenFromCookie = req.cookies?.token || null;
			const token = tokenFromHeader || tokenFromCookie;
			if (!token) return res.status(401).json({ error: 'Unauthorized' });
			const payload = jwt.verify(token, process.env.JWT_SECRET);
			req.user = payload;
			if (roles.length && !roles.includes(payload.role)) {
				return res.status(403).json({ error: 'Forbidden' });
			}
			next();
		} catch { return res.status(401).json({ error: 'Unauthorized' }); }
	};
}
