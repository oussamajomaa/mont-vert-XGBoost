import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function Login() {
    const { register, handleSubmit } = useForm()
    const { login } = useAuth()
    const navigate = useNavigate()

    async function onSubmit(values) {
        try {
            await login(values.email, values.password)
            navigate('/', { replace: true })
        } catch (e) {
            // console.log(e)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-100">
            <form onSubmit={handleSubmit(onSubmit)} className="bg-white p-6 rounded shadow w-full max-w-sm">
                <h1 className="text-xl font-semibold mb-4">Login</h1>
                <label className="block text-sm mb-1">Email</label>
                <input {...register('email', { required: true })} type="email" className="w-full mb-3 border rounded px-3 py-2" />
                <label className="block text-sm mb-1">Password</label>
                <input {...register('password', { required: true })} type="password" className="w-full mb-4 border rounded px-3 py-2" />
                <button className="w-full bg-slate-800 text-white rounded py-2 hover:bg-slate-700">Sign in</button>
                <p className="text-sm text-slate-500 mt-3">Need an account? Ask an admin to register you.</p>
            </form>
        </div>
    )
}
