import { useForm } from 'react-hook-form'
import { useAuth } from '../auth/AuthContext'
import Layout from '../components/Layout'
import toast from 'react-hot-toast'

export default function Register() {
    const {register:reg, handleSubmit, reset } = useForm({ defaultValues: { role: 'KITCHEN' } })
    const { register: registerUser } = useAuth()

    async function onSubmit(values) {
        try {
            await registerUser(values)
            // alert('User created')
            reset({ name: '', email: '', password: '', role: 'KITCHEN' })
            toast.success('User created');
        } catch (e) {
            // alert('Failed to create user (email may exist).')
            // console.log(e)
        }
    }

    return (
        <Layout>
            <div className='flex justify-center items-center  h-[calc(100vh-48px)]'>
                <div className=" w-[600px]">
                    <h1 className="text-xl text-center font-semibold mb-4">Register a new user</h1>
                    <form onSubmit={handleSubmit(onSubmit)} className="bg-white p-4 rounded shadow">
                        <label className="block text-sm mb-1">Name</label>
                        <input {...reg('name', { required: true })} className="w-full mb-3 border rounded px-3 py-2" />
                        <label className="block text-sm mb-1">Email</label>
                        <input type="email" {...reg('email', { required: true })} className="w-full mb-3 border rounded px-3 py-2" />
                        <label className="block text-sm mb-1">Password</label>
                        <input type="password" {...reg('password', { required: true, minLength: 6 })} className="w-full mb-3 border rounded px-3 py-2" />
                        <label className="block text-sm mb-1">Role</label>
                        <select {...reg('role', { required: true })} className="w-full mb-4 border rounded px-3 py-2">
                            <option value="KITCHEN">KITCHEN</option>
                            <option value="DIRECTOR">DIRECTOR</option>
                            <option value="ADMIN">ADMIN</option>
                        </select>
                        <button className="bg-slate-800 text-white rounded px-4 py-2 hover:bg-slate-700">Create</button>
                    </form>
                </div>
            </div>
        </Layout>
    )
}
