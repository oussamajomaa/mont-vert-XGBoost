// server/src/auth/auth.routes.js
import { Router } from 'express';
import { pool } from '../db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../auth/auth.middleware.js';

import { z } from 'zod';

const router = Router();

const loginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(3)
});

router.post('/login', async (req, res, next) => {
	try {
		const { email, password } = loginSchema.parse(req.body);
		const [rows] = await pool.query('SELECT * FROM user WHERE email=? AND active=TRUE', [email]);
		const user = rows[0];
		if (!user) return res.status(401).json({ error: 'Invalid credentials' });
		const ok = await bcrypt.compare(password, user.password);
		if (!ok) return res.status(401).json({ error: 'Invalid credentials' });



		const token = jwt.sign(
			{ sub: user.id, role: user.role, name: user.name },
			process.env.JWT_SECRET,
			{ expiresIn: process.env.JWT_EXPIRES || '12h' }
		)

		res.cookie('token', token, {
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'lax',
			maxAge: 12 * 3600 * 1000
		})
		res.status(200).json({
			user: { id: user.id, name: user.name, role: user.role, email: user.email }
			// pas besoin de renvoyer le token si tu utilises le cookie
		});
		// res.json({ token, user: { id: user.id, name: user.name, role: user.role, email: user.email } });
	} catch (e) { next(e); }
});

const registerSchema = z.object({
	name: z.string().min(2),
	email: z.string().email(),
	password: z.string().min(3),
	role: z.enum(['ADMIN', 'KITCHEN', 'DIRECTOR'])
});

router.post('/register', requireAuth(['ADMIN']), async (req, res, next) => {
	try {
		const { name, email, password, role } = registerSchema.parse(req.body);
		const [exists] = await pool.query('SELECT id FROM user WHERE email=?', [email]);
		if (exists.length) return res.status(409).json({ error: 'Email already exists' });
		const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS || 10));
		await pool.query(
			'INSERT INTO user (name,email,password,role,active) VALUES (?,?,?,?,TRUE)',
			[name, email, hash, role]
		);
		res.status(201).json({ message: 'user created' });
	} catch (e) { next(e); }
});

// LOGOUT: supprime le cookie JWT
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  return res.status(204).end();
});

export default router;
