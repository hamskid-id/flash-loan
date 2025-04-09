'use client'

import { useState, useEffect } from 'react'
import {
  BrowserProvider,
  Contract,
  // Signer,
  ethers,
} from 'ethers'
import { Button } from '../ui/button'
import { longTradeABI, shortTradeABI } from '@/lib/constants'
import { toast } from 'sonner'
import { BSC_MAINNET_CONFIG } from '@/lib/bscConfig'

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider
  }
  interface EthereumRpcError extends Error {
    code: number
    message: string
  }
}

const longTradeAddress = '0xe76aa7e39763e6fa260e13a24c6d76a8abf4305b'
const shortTradeAddress = '0x92158730bee648250e0a10e44fef3661b8d2e2b8'

export default function Home() {
  //   const [provider, setProvider] = useState<BrowserProvider | null>(null)
  //   const [signer, setSigner] = useState<Signer | null>(null)
  const [longTradeContract, setLongTradeContract] = useState<Contract | null>(
    null
  )
  const [shortTradeContract, setShortTradeContract] = useState<Contract | null>(
    null
  )
  const [isConnected, setIsConnected] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [executionInterval, setExecutionInterval] =
    useState<NodeJS.Timeout | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  // Connect to MetaMask
  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        // Check current network
        const chainId = await window.ethereum.request({ method: 'eth_chainId' })

        // Switch to BSC if not already connected
        if (chainId !== BSC_MAINNET_CONFIG.chainId) {
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: BSC_MAINNET_CONFIG.chainId }],
            })
          } catch (switchError) {
            const err = switchError as EthereumRpcError
            // This error code indicates the chain hasn't been added to MetaMask
            if (err.code === 4902) {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [BSC_MAINNET_CONFIG],
              })
            } else {
              throw switchError
            }
          }
        }

        await window.ethereum.request({
          method: 'eth_requestAccounts',
        })

        const web3Provider = new BrowserProvider(window.ethereum)
        const web3Signer = await web3Provider.getSigner()

        const longTrade = new Contract(
          longTradeAddress,
          longTradeABI,
          web3Signer
        )
        const shortTrade = new Contract(
          shortTradeAddress,
          shortTradeABI,
          web3Signer
        )

        setLongTradeContract(longTrade)
        setShortTradeContract(shortTrade)
        setIsConnected(true)

        toast.success('Wallet connected to BSC successfully')
      } catch (error) {
        const err = error as EthereumRpcError
        let errorMessage = 'Error connecting wallet'

        if (err.code === 4001) {
          errorMessage = 'Please connect to Binance Smart Chain'
        } else if (
          err?.message &&
          err?.message.includes('user rejected request')
        ) {
          errorMessage = 'Connection rejected by user'
        }

        toast.error(errorMessage)
      }
    } else {
      toast.error('MetaMask not detected. Please install MetaMask.')
    }
  }

  // Execute both contracts
  const executeContracts = async () => {
    if (!longTradeContract || !shortTradeContract) {
      toast.dismiss()
      toast.error('Contracts not initialized. Please connect wallet first.')
      return
    }

    try {
      setIsRunning(true)

      // BSC typically uses lower gas prices than Ethereum
      const txOptions = {
        gasPrice: ethers.parseUnits('5', 'gwei'), // 5 Gwei is typical for BSC
        gasLimit: 500000, // Adjust based on your contract's needs
      }

      const tx1 = longTradeContract.initiateFlashLoan(txOptions)
      const tx2 = shortTradeContract.initiateFlashLoan(txOptions)

      await Promise.all([tx1, tx2])
      toast.dismiss()
      toast.success('Flash loans initiated successfully on BSC!')
      addLog('Flash loans initiated successfully!')
    } catch (error) {
      toast.dismiss()
      console.log(error)
      let userMessage = 'Transaction was rejected'

      if (typeof error === 'object' && error !== null) {
        const err = error as {
          code?: number
          reason?: string
          message?: string
          info?: {
            error?: {
              message?: string
            }
          }
        }

        // Handle specific MetaMask rejection cases
        if (err.code === 4001 || err.reason === 'rejected') {
          userMessage = 'You rejected the transaction'
        }
        // Handle ethers.js rejection format
        else if (err.message?.includes('user denied transaction')) {
          userMessage = 'You denied the transaction'
        }
        // Handle other cases while sanitizing
        else if (err.info?.error?.message) {
          userMessage = sanitizeErrorMessage(err.info.error.message)
        }
      }

      toast.error(userMessage)
      addLog(userMessage)
      setIsRunning(false)
    } finally {
      setIsRunning(false)
    }
  }

  // Start interval execution
  const startIntervalExecution = () => {
    if (executionInterval) {
      clearInterval(executionInterval)
    }

    console.log('Starting interval execution (every 3 seconds)')

    // Execute immediately first
    executeContracts()

    // Then set up interval
    const interval = setInterval(() => {
      executeContracts()
    }, 3000)

    setExecutionInterval(interval)
  }

  // Stop execution
  const stopExecution = () => {
    if (executionInterval) {
      setIsRunning(false)
      clearInterval(executionInterval)
      setExecutionInterval(null)
      toast.dismiss()
      toast('Execution stopped')
    }
  }

  // Run once
  const runOnce = () => {
    toast('Executing contracts once')
    executeContracts()
  }

  // Add log message
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs((prev) => [...prev, `${timestamp}: ${message}`])
  }

  // Helper function to sanitize technical error messages
  const sanitizeErrorMessage = (message: string): string => {
    const patterns = [
      { regex: /MetaMask Tx Signature: (.*)/, replace: '$1' },
      { regex: /ethers-user-denied: (.*)/, replace: 'Action cancelled' },
      { regex: /execution reverted: (.*)/, replace: 'Transaction failed: $1' },
    ]

    for (const pattern of patterns) {
      if (pattern.regex.test(message)) {
        return message.replace(pattern.regex, pattern.replace)
      }
    }

    // Fallback to generic message if technical details remain
    return 'Transaction failed'
  }

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (executionInterval) {
        clearInterval(executionInterval)
      }
    }
  }, [executionInterval])

  return (
    <div className='min-h-screen bg-gray-100'>
      <div className='container mx-auto pb-8 px-4 md:pt-[5rem] pt-8'>
        <h1 className='text-3xl font-bold text-center mb-8'>
          Flash Loan Web Application
        </h1>

        <div className='max-w-3xl mx-auto bg-white rounded-lg border-dotted border-2 p-6'>
          {!isConnected ? (
            <div className='text-center'>
              <Button
                onClick={connectWallet}
                className='bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-colors'
              >
                Connect Wallet
              </Button>
              <p className='mt-4 text-gray-600'>
                Please connect your MetaMask wallet to continue
              </p>
            </div>
          ) : (
            <>
              <div className='mb-6'>
                <h2 className='text-xl font-semibold mb-4'>
                  Execution Controls
                </h2>
                <div className='flex flex-wrap gap-4'>
                  <Button
                    onClick={startIntervalExecution}
                    disabled={isRunning}
                    className={`py-2 px-4 rounded-lg font-medium ${
                      isRunning
                        ? 'bg-gray-300 cursor-not-allowed'
                        : 'bg-green-600 hover:bg-green-700 text-white'
                    }`}
                  >
                    Start (3s interval)
                  </Button>
                  <Button
                    onClick={stopExecution}
                    disabled={!isRunning}
                    className={`py-2 px-4 rounded-lg font-medium ${
                      !isRunning
                        ? 'bg-gray-300 cursor-not-allowed'
                        : 'bg-red-600 hover:bg-red-700 text-white'
                    }`}
                  >
                    Stop
                  </Button>
                  <Button
                    onClick={runOnce}
                    className='bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg font-medium'
                  >
                    Run Once
                  </Button>
                </div>
              </div>

              <div>
                <h2 className='text-xl font-semibold mb-4'>Execution Logs</h2>
                <div className='bg-gray-50 p-4 rounded-lg h-64 overflow-y-auto font-mono text-sm'>
                  {logs.length === 0 ? (
                    <p className='text-gray-500'>
                      No logs yet. Execute a transaction to see logs.
                    </p>
                  ) : (
                    logs.map((log, index) => (
                      <div
                        key={index}
                        className='mb-1 border-b border-gray-200 pb-1'
                      >
                        {log}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className='mt-6'>
                <h2 className='text-xl font-semibold mb-2'>
                  Contract Addresses
                </h2>
                <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                  <div className='bg-gray-50 p-3 rounded-lg'>
                    <h3 className='font-medium text-gray-700'>Long Trade</h3>
                    <p className='text-sm text-gray-600 break-all'>
                      {longTradeAddress}
                    </p>
                  </div>
                  <div className='bg-gray-50 p-3 rounded-lg'>
                    <h3 className='font-medium text-gray-700'>Short Trade</h3>
                    <p className='text-sm text-gray-600 break-all'>
                      {shortTradeAddress}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
