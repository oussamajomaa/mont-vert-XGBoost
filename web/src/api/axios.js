import axios from 'axios'
import toast from 'react-hot-toast';

const api = axios.create({
	baseURL: import.meta.env.VITE_API_URL,
	withCredentials: true, // << envoie/ reçoit le cookie HttpOnly
})

api.interceptors.response.use(
	(res) => res,
	(err) => {
		const data = err?.response?.data || {};
		const msg = data.error || data.message || err.message || 'Request failed';
		toast.error(msg);
		return Promise.reject(err);
	}
)

export default api